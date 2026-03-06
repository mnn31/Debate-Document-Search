import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.originalname.endsWith(".docx")) {
      cb(null, true);
    } else {
      cb(new Error("Only .docx files are allowed"));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function cleanupFile(filePath: string) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
}

function parseDocxSections(htmlContent: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];

  const parts = htmlContent.split(/(?=<h[1-6])/i);

  for (const part of parts) {
    const headingMatch = part.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const heading = headingMatch ? headingMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    const content = part
      .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (heading || content) {
      sections.push({ heading, content });
    }
  }

  if (sections.length === 0 && htmlContent.trim()) {
    const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (plainText) sections.push({ heading: "Document Content", content: plainText });
  }

  const textLines = htmlContent.replace(/<[^>]*>/g, "\n").split("\n").filter(l => l.trim());
  const debateSections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of textLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeadingLike =
      (trimmed.length < 80 && /^[A-Z!]/.test(trimmed) && !trimmed.endsWith(".")) ||
      trimmed.includes("---") ||
      trimmed.startsWith("1AR") || trimmed.startsWith("1NC") || trimmed.startsWith("2AR") || trimmed.startsWith("2NC") ||
      /^(Impact|Link|Internal Link|Uniqueness|Turn|Shell|Frontline|Extension|AT:|A2:)/i.test(trimmed);

    if (isHeadingLike && currentContent.length > 0) {
      debateSections.push({
        heading: currentHeading,
        content: currentContent.join(" ").trim(),
      });
      currentHeading = trimmed;
      currentContent = [];
    } else if (isHeadingLike && currentContent.length === 0) {
      currentHeading = currentHeading ? `${currentHeading} - ${trimmed}` : trimmed;
    } else {
      currentContent.push(trimmed);
    }
  }

  if (currentContent.length > 0) {
    debateSections.push({
      heading: currentHeading,
      content: currentContent.join(" ").trim(),
    });
  }

  const allSections = [...sections];
  for (const ds of debateSections) {
    const isDuplicate = allSections.some(
      (s) => s.heading === ds.heading || (ds.content.length > 50 && s.content.includes(ds.content.slice(0, 50)))
    );
    if (!isDuplicate && ds.content.length > 20) {
      allSections.push(ds);
    }
  }

  return allSections;
}

async function generateAiKeywords(
  filename: string,
  sections: Array<{ heading: string; content: string }>,
  tags: string[]
): Promise<string[]> {
  try {
    const headings = sections.map((s) => s.heading).filter(Boolean).slice(0, 10).join(", ");
    const preview = sections.map((s) => s.content).join(" ").slice(0, 500);

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [
        {
          role: "user",
          content: `Generate 25 debate search keywords for this evidence file. Include debate abbreviations (cap good, dedev, heg, nuke war), synonyms, argument types (impact turn, link turn), and topic areas.

File: ${filename}
Tags: ${tags.join(", ")}
Headings: ${headings}
Preview: ${preview}

Return ONLY a JSON array of keyword strings, nothing else.`,
        },
      ],
      max_completion_tokens: 4096,
    });

    let content = response.choices[0]?.message?.content || "[]";
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let keywords: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        keywords = parsed;
      } else if (parsed.keywords && Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords;
      }
    } catch {
      console.error("Failed to parse AI keywords response:", content.slice(0, 200));
    }
    return keywords.map((k: string) => String(k).toLowerCase().trim()).filter(Boolean);
  } catch (error) {
    console.error("AI keyword generation error:", error);
    return [];
  }
}

function buildSearchIndex(
  filename: string,
  tags: string[],
  sections: Array<{ heading: string; content: string }>,
  aiKeywords: string[]
): string {
  const parts = [
    filename.replace(/\.docx$/i, "").replace(/[_-]/g, " "),
    ...tags,
    ...sections.map((s) => s.heading),
    ...aiKeywords,
  ];
  return parts.join(" ").toLowerCase();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let tags: string[] = [];
      if (req.body.tags) {
        try {
          const parsed = JSON.parse(req.body.tags);
          if (Array.isArray(parsed) && parsed.every((t: any) => typeof t === "string")) {
            tags = parsed;
          }
        } catch {
          if (req.file) cleanupFile(req.file.path);
          return res.status(400).json({ error: "Invalid tags format" });
        }
      }

      const filePath = req.file.path;
      const result = await mammoth.convertToHtml({ path: filePath });
      const htmlContent = result.value;
      const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const parsedSections = parseDocxSections(htmlContent);

      const doc = await storage.createDocument({
        filename: req.file.filename,
        originalFilename: req.file.originalname,
        tags,
        textContent: plainText,
        aiKeywords: [],
        searchIndex: "",
      });

      const sectionData = parsedSections.map((s, i) => ({
        documentId: doc.id,
        heading: s.heading,
        content: s.content,
        sectionIndex: i,
      }));
      await storage.createSections(sectionData);

      res.json({
        id: doc.id,
        originalFilename: doc.originalFilename,
        tags: doc.tags,
        uploadedAt: doc.uploadedAt,
        indexing: true,
      });

      generateAiKeywords(req.file.originalname, parsedSections, tags).then(async (aiKeywords) => {
        const searchIndex = buildSearchIndex(req.file!.originalname, tags, parsedSections, aiKeywords);
        await storage.updateDocumentAiData(doc.id, aiKeywords, searchIndex);
        console.log(`Indexed document ${doc.id} (${req.file!.originalname}) with ${aiKeywords.length} AI keywords`);
      }).catch((err) => {
        console.error(`Failed to index document ${doc.id}:`, err);
      });

    } catch (error: any) {
      if (req.file) cleanupFile(req.file.path);
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message || "Upload failed" });
    }
  });

  app.get("/api/documents", async (_req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      const lightweight = docs.map((d) => ({
        id: d.id,
        filename: d.filename,
        originalFilename: d.originalFilename,
        tags: d.tags,
        aiKeywords: d.aiKeywords,
        uploadedAt: d.uploadedAt,
        textPreview: d.textContent.slice(0, 200),
        indexed: d.aiKeywords.length > 0,
      }));
      res.json(lightweight);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch documents" });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const sections = await storage.getSectionsByDocumentId(doc.id);
      res.json({ ...doc, sections });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch document" });
    }
  });

  app.get("/api/documents/:id/download", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const filePath = path.join(uploadDir, doc.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`);
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Download failed" });
    }
  });

  app.patch("/api/documents/:id/tags", async (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags) || !tags.every((t: any) => typeof t === "string")) {
        return res.status(400).json({ error: "Tags must be an array of strings" });
      }
      const updated = await storage.updateDocumentTags(parseInt(req.params.id), tags);
      if (!updated) return res.status(404).json({ error: "Document not found" });

      const sections = await storage.getSectionsByDocumentId(updated.id);
      const parsedSections = sections.map((s) => ({ heading: s.heading, content: s.content }));
      const searchIndex = buildSearchIndex(updated.originalFilename, tags, parsedSections, updated.aiKeywords);
      await storage.updateDocumentAiData(updated.id, updated.aiKeywords, searchIndex);

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update tags" });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      cleanupFile(path.join(uploadDir, doc.filename));
      await storage.deleteDocument(doc.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete document" });
    }
  });

  app.post("/api/search", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ error: "Search query is required" });
      }

      const searchQuery = query.trim();

      const dbResults = await storage.fullTextSearch(searchQuery);

      const resultsWithSections = await Promise.all(
        dbResults.map(async ({ doc, rank }) => {
          const sections = await storage.getSectionsByDocumentId(doc.id);

          const queryWords = searchQuery.toLowerCase().split(/\s+/);
          const matchingSections = sections.filter((s) =>
            queryWords.some(
              (w) =>
                s.heading.toLowerCase().includes(w) ||
                s.content.toLowerCase().includes(w)
            )
          );

          return {
            document: {
              id: doc.id,
              filename: doc.filename,
              originalFilename: doc.originalFilename,
              tags: doc.tags,
              aiKeywords: doc.aiKeywords,
              uploadedAt: doc.uploadedAt,
            },
            matchingSections: matchingSections.length > 0 ? matchingSections : sections.slice(0, 2),
            rank,
            aiSummary: "",
            sectionHint: matchingSections[0]?.heading || sections[0]?.heading || "",
          };
        })
      );

      res.json({
        results: resultsWithSections,
        aiEnhanced: false,
        query: searchQuery,
      });
    } catch (error: any) {
      console.error("Search error:", error);
      res.status(500).json({ error: error.message || "Search failed" });
    }
  });

  app.post("/api/search/ai-enhance", async (req, res) => {
    try {
      const { query, documentIds } = req.body;
      if (!query || !Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: "Query and documentIds required" });
      }

      const docs = await Promise.all(
        documentIds.slice(0, 10).map(async (id: number) => {
          const doc = await storage.getDocument(id);
          if (!doc) return null;
          const sections = await storage.getSectionsByDocumentId(id);
          return { doc, sections };
        })
      );

      const validDocs = docs.filter(Boolean) as Array<{ doc: any; sections: any[] }>;

      const docSummary = validDocs.map((d) => {
        const sectionText = d.sections
          .map((s: any) => `[${s.heading}]: ${s.content.slice(0, 200)}`)
          .slice(0, 8)
          .join("\n");
        return `ID:${d.doc.id} | ${d.doc.originalFilename} | Tags: ${d.doc.tags.join(", ")}\n${sectionText}`;
      }).join("\n---\n");

      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          {
            role: "system",
            content: `You are a Public Forum Debate evidence assistant. For each document, provide a ONE sentence summary explaining what content is relevant to the search query. Be specific about the debate argument, not generic. Focus on what a debater needs to know to decide if this file helps them right now.

Return ONLY a JSON object (no explanation) with "summaries": array of {"id": number, "summary": string, "sectionHint": string}`,
          },
          {
            role: "user",
            content: `Search: "${query}"\n\nDocuments:\n${docSummary}`,
          },
        ],
        max_completion_tokens: 8192,
      });

      let content = response.choices[0]?.message?.content || "{}";
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let summaries: Record<number, { summary: string; sectionHint: string }> = {};
      try {
        const parsed = JSON.parse(content);
        const arr = parsed.summaries || parsed.results || [];
        for (const item of arr) {
          summaries[item.id] = { summary: item.summary, sectionHint: item.sectionHint || "" };
        }
      } catch {}

      res.json({ summaries });
    } catch (error: any) {
      console.error("AI enhance error:", error);
      res.status(500).json({ error: "AI enhancement failed" });
    }
  });

  app.post("/api/search/semantic", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query required" });
      }

      const allDocs = await storage.getAllDocuments();
      if (allDocs.length === 0) {
        return res.json({ results: [] });
      }

      const docSummaries = await Promise.all(
        allDocs.slice(0, 30).map(async (doc) => {
          const sections = await storage.getSectionsByDocumentId(doc.id);
          return {
            id: doc.id,
            filename: doc.originalFilename,
            tags: doc.tags,
            aiKeywords: doc.aiKeywords.slice(0, 10),
            headings: sections.map((s) => s.heading).filter(Boolean).slice(0, 8),
            preview: doc.textContent.slice(0, 200),
          };
        })
      );

      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          {
            role: "system",
            content: `You are a Public Forum Debate search engine. A debater is searching for evidence. Find ALL relevant documents from their library. Think about:
- Synonyms (dedev = degrowth = economic decline good)
- Arguments that RESPOND to the search concept
- Impact chains that INCLUDE the searched concept
- Related debate terminology

Return ONLY JSON (no explanation): {"results": [{"id": number, "relevance": "one sentence", "sectionHint": "section name"}]}
Only include truly relevant docs. Order by relevance.`,
          },
          {
            role: "user",
            content: `Search: "${query}"\n\nLibrary:\n${docSummaries.map((d) => `ID:${d.id}|${d.filename}|Tags:${d.tags.join(",")}|Keywords:${d.aiKeywords.join(",")}|Headings:${d.headings.join(",")}`).join("\n")}`,
          },
        ],
        max_completion_tokens: 8192,
      });

      let content = response.choices[0]?.message?.content || "{}";
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let aiResults: Array<{ id: number; relevance: string; sectionHint: string }> = [];
      try {
        const parsed = JSON.parse(content);
        aiResults = parsed.results || [];
      } catch {}

      const enrichedResults = [];
      for (const aiResult of aiResults) {
        const doc = allDocs.find((d) => d.id === aiResult.id);
        if (doc) {
          const sections = await storage.getSectionsByDocumentId(doc.id);
          enrichedResults.push({
            document: {
              id: doc.id,
              filename: doc.filename,
              originalFilename: doc.originalFilename,
              tags: doc.tags,
              aiKeywords: doc.aiKeywords,
              uploadedAt: doc.uploadedAt,
            },
            matchingSections: sections.slice(0, 3),
            rank: 0,
            aiSummary: aiResult.relevance,
            sectionHint: aiResult.sectionHint,
          });
        }
      }

      res.json({ results: enrichedResults });
    } catch (error: any) {
      console.error("Semantic search error:", error);
      res.status(500).json({ error: "Semantic search failed" });
    }
  });

  app.post("/api/analyze-opponent-case", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filePath = req.file.path;
      const result = await mammoth.convertToHtml({ path: filePath });
      const htmlContent = result.value;
      const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

      const allDocs = await storage.getAllDocuments();
      if (allDocs.length === 0) {
        cleanupFile(filePath);
        return res.json({ arguments: [], responses: [] });
      }

      const docSummaries = await Promise.all(
        allDocs.slice(0, 30).map(async (doc) => {
          const sections = await storage.getSectionsByDocumentId(doc.id);
          return {
            id: doc.id,
            filename: doc.originalFilename,
            tags: doc.tags,
            aiKeywords: doc.aiKeywords.slice(0, 10),
            sectionHeadings: sections.map((s) => s.heading).filter(Boolean),
            contentPreview: doc.textContent.slice(0, 300),
          };
        })
      );

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          {
            role: "system",
            content: `You are a Public Forum Debate analyst. Analyze the opponent's case and find responses from the user's evidence library.

Return JSON:
- "arguments": [{"claim": "argument description", "impactChain": "step1 -> step2 -> step3"}]
- "responses": [{"opponentClaim": "what they argue", "responseDocId": number, "responseFilename": "name", "explanation": "one sentence", "sectionHint": "section"}]

Be specific. Only include confident matches. Return ONLY JSON, no explanation.`,
          },
          {
            role: "user",
            content: `OPPONENT'S CASE:\n${plainText.slice(0, 4000)}\n\nMY EVIDENCE:\n${docSummaries.map((d) => `ID:${d.id}|${d.filename}|Tags:${d.tags.join(",")}|Keywords:${d.aiKeywords.join(",")}|Sections:${d.sectionHeadings.join(",")}`).join("\n")}`,
          },
        ],
        max_completion_tokens: 8192,
      });

      let aiContent = aiResponse.choices[0]?.message?.content || "{}";
      aiContent = aiContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let parsed: any = {};
      try { parsed = JSON.parse(aiContent); } catch {}
      cleanupFile(filePath);

      res.json({
        arguments: parsed.arguments || [],
        responses: parsed.responses || [],
        caseText: plainText.slice(0, 2000),
      });
    } catch (error: any) {
      console.error("Analyze error:", error);
      if (req.file) cleanupFile(req.file.path);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  app.post("/api/documents/:id/reindex", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });

      const sections = await storage.getSectionsByDocumentId(doc.id);
      const parsedSections = sections.map((s) => ({ heading: s.heading, content: s.content }));
      const aiKeywords = await generateAiKeywords(doc.originalFilename, parsedSections, doc.tags);
      const searchIndex = buildSearchIndex(doc.originalFilename, doc.tags, parsedSections, aiKeywords);
      await storage.updateDocumentAiData(doc.id, aiKeywords, searchIndex);

      res.json({ success: true, keywords: aiKeywords.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Reindex failed" });
    }
  });

  return httpServer;
}
