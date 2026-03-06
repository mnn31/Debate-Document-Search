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
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function parseDocxSections(htmlContent: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  const lines = htmlContent.split(/(?=<h[1-6])/i);

  for (const line of lines) {
    const headingMatch = line.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const heading = headingMatch ? headingMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    const content = line
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
    sections.push({ heading: "Document Content", content: plainText });
  }

  return sections;
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
          } else {
            if (req.file) cleanupFile(req.file.path);
            return res.status(400).json({ error: "Tags must be an array of strings" });
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

      const doc = await storage.createDocument({
        filename: req.file.filename,
        originalFilename: req.file.originalname,
        tags,
        textContent: plainText,
      });

      const parsedSections = parseDocxSections(htmlContent);
      const sectionData = parsedSections.map((s, i) => ({
        documentId: doc.id,
        heading: s.heading,
        content: s.content,
        sectionIndex: i,
      }));

      await storage.createSections(sectionData);

      res.json({ id: doc.id, originalFilename: doc.originalFilename, tags: doc.tags, uploadedAt: doc.uploadedAt });
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
        uploadedAt: d.uploadedAt,
        textPreview: d.textContent.slice(0, 200),
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
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update tags" });
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });

      const filePath = path.join(uploadDir, doc.filename);
      cleanupFile(filePath);

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
      const allDocs = await storage.getAllDocuments();

      if (allDocs.length === 0) {
        return res.json({ results: [], aiEnhanced: false });
      }

      const dbResults = await storage.searchDocuments(searchQuery);

      const allDocSummaries = await Promise.all(
        allDocs.slice(0, 25).map(async (doc) => {
          const sections = await storage.getSectionsByDocumentId(doc.id);
          return {
            id: doc.id,
            filename: doc.originalFilename,
            tags: doc.tags,
            sections: sections.map((s) => `[${s.heading}]: ${s.content.slice(0, 200)}`).join("\n"),
            dbMatch: dbResults.some((r) => r.id === doc.id),
          };
        })
      );

      try {
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-5-nano",
          messages: [
            {
              role: "system",
              content: `You are a Public Forum Debate evidence search assistant. The user needs to find arguments in their evidence files FAST during a debate round. Given a search query and documents, identify ALL relevant documents. Think about:
- Synonyms and related concepts (dedev = degrowth = economic decline good)
- Debate-specific terminology and impact chains
- Arguments that respond to or counter the searched concept
- Documents that discuss the same topic from any angle

Return a JSON object with a "results" array. Each result has:
- "id": document id number
- "relevance": ONE sentence explaining what in this document relates to the search query. Be specific about the argument, not generic.
- "sectionHint": which section heading to look at

Only include truly relevant documents. Rank by relevance (most relevant first).`,
            },
            {
              role: "user",
              content: `Search: "${searchQuery}"\n\nDocuments:\n${allDocSummaries.map((d) => `ID:${d.id} | File: ${d.filename} | Tags: ${d.tags.join(", ")}${d.dbMatch ? " [KEYWORD MATCH]" : ""}\n${d.sections}`).join("\n---\n")}`,
            },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1500,
        });

        const aiContent = aiResponse.choices[0]?.message?.content || "{}";
        let aiResults: Array<{ id: number; relevance: string; sectionHint: string }> = [];
        try {
          const parsed = JSON.parse(aiContent);
          aiResults = parsed.results || parsed.documents || parsed.matches || [];
        } catch {
          aiResults = [];
        }

        if (aiResults.length === 0 && dbResults.length > 0) {
          const results = dbResults.map((doc) => ({
            document: {
              id: doc.id,
              filename: doc.filename,
              originalFilename: doc.originalFilename,
              tags: doc.tags,
              uploadedAt: doc.uploadedAt,
            },
            matchingSections: doc.matchingSections,
            aiSummary: "Matches your search query based on keyword match.",
            sectionHint: doc.matchingSections[0]?.heading || "",
          }));
          return res.json({ results, aiEnhanced: false });
        }

        const enrichedResults = [];
        for (const aiResult of aiResults) {
          const doc = allDocs.find((d) => d.id === aiResult.id);
          if (doc) {
            const dbMatch = dbResults.find((r) => r.id === doc.id);
            const sections = dbMatch
              ? dbMatch.matchingSections
              : await storage.getSectionsByDocumentId(doc.id);

            enrichedResults.push({
              document: {
                id: doc.id,
                filename: doc.filename,
                originalFilename: doc.originalFilename,
                tags: doc.tags,
                uploadedAt: doc.uploadedAt,
              },
              matchingSections: sections,
              aiSummary: aiResult.relevance,
              sectionHint: aiResult.sectionHint,
            });
          }
        }

        return res.json({ results: enrichedResults, aiEnhanced: true });
      } catch (aiError) {
        console.error("AI search error:", aiError);
        if (dbResults.length > 0) {
          const results = dbResults.map((doc) => ({
            document: {
              id: doc.id,
              filename: doc.filename,
              originalFilename: doc.originalFilename,
              tags: doc.tags,
              uploadedAt: doc.uploadedAt,
            },
            matchingSections: doc.matchingSections,
            aiSummary: "Matches your search query.",
            sectionHint: doc.matchingSections[0]?.heading || "",
          }));
          return res.json({ results, aiEnhanced: false });
        }
        return res.json({ results: [], aiEnhanced: false });
      }
    } catch (error: any) {
      console.error("Search error:", error);
      res.status(500).json({ error: error.message || "Search failed" });
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
            content: `You are a Public Forum Debate analyst. The user has uploaded their opponent's case. Analyze it to:
1. Extract the key arguments and the impact chain (e.g., "Trade war -> Economic decline -> Nuclear war -> Extinction")
2. For each argument/claim/impact, find responsive evidence from the user's evidence library.

Return a JSON object with:
- "arguments": array of objects with "claim" (the opponent's argument) and "impactChain" (the link chain)  
- "responses": array of objects with "opponentClaim" (what opponent argues), "responseDocId" (document id from library), "responseFilename" (filename), "explanation" (one sentence on how this document responds to the opponent's claim), "sectionHint" (which section to look at)

Only include responses where you're confident there's relevant evidence. Be specific about debate arguments.`,
          },
          {
            role: "user",
            content: `OPPONENT'S CASE:\n${plainText.slice(0, 4000)}\n\nMY EVIDENCE LIBRARY:\n${docSummaries.map((d) => `ID:${d.id} | ${d.filename} | Tags: ${d.tags.join(", ")} | Sections: ${d.sectionHeadings.join(", ")} | Preview: ${d.contentPreview}`).join("\n")}`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2048,
      });

      const aiContent = aiResponse.choices[0]?.message?.content || "{}";
      let parsed: any = {};
      try {
        parsed = JSON.parse(aiContent);
      } catch {}

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

  return httpServer;
}
