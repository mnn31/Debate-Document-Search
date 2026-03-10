import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";
import JSZip from "jszip";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const DEBATE_TERMINOLOGY = `
Public Forum Debate terminology you MUST understand:
- UQ/U = Uniqueness (current state of the world regarding a specific issue)
- L = Link (how the resolution connects to a point)
- IL = Internal Link (how one point connects to another in a chain)
- ! = Impact (terminal impact or final consequence)
- NUQ = Nonunique (the impact is already happening regardless)
- NL = No Link (the resolution doesn't actually cause this)
- L/T = Link Turn (the resolution actually does the OPPOSITE of what opponent claims)
- N! = No Impact (even if the link is true, it doesn't matter)
- !/T = Impact Turn (the impact is actually GOOD, not bad)
- Dedev/degrowth = arguments that economic decline/degrowth is good
- Cap good/bad = capitalism is good/bad
- Heg = hegemony (US global military/political dominance)
- Prolif = proliferation (nuclear weapons spreading)
- Nuke war = nuclear war
- SCS = South China Sea
- China rise = China's increasing power/influence globally
- Soft power = diplomatic/cultural influence (vs hard power = military)
- Diversionary war = leaders start wars to distract from domestic problems
- Interdependence = economic ties between nations
`;

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
      /^(Impact|Link|Internal Link|Uniqueness|Turn|Shell|Frontline|Extension|AT:|A2:|Contention)/i.test(trimmed);

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

interface ParsedCard {
  tag: string;
  cite: string;
  body: string;
  isAnalytic: boolean;
}

function parseEvidenceCards(htmlContent: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  const paragraphs: Array<{ text: string; isBold: boolean; isUnderline: boolean; isHighlight: boolean; headingLevel: number; html: string }> = [];

  const blockPattern = /<(p|h[1-6])[^>]*>([\s\S]*?)<\/(?:p|h[1-6])>/gi;
  let match;
  while ((match = blockPattern.exec(htmlContent)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const isBold = /<strong|<b[\s>]|font-weight:\s*bold/i.test(innerHtml);
    const isUnderline = /<u[\s>]|text-decoration[^"]*underline/i.test(innerHtml);
    const isHighlight = /background-color|<mark/i.test(innerHtml);
    const headingMatch = tagName.match(/^h(\d)$/);
    const headingLevel = headingMatch ? parseInt(headingMatch[1]) : 0;

    paragraphs.push({
      text,
      isBold: isBold || headingLevel > 0,
      isUnderline,
      isHighlight,
      headingLevel,
      html: innerHtml,
    });
  }

  if (paragraphs.length === 0) return [];

  const citePattern = /^[\[\(]?\s*[A-Z][a-zA-Z'\-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z'\-]+))?\s*(?:,?\s*(?:'?\d{2,4}|20[0-2]\d|19\d{2}))/;
  const citePattern2 = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/;
  const citePattern3 = /(?:PhD|Professor|Dr\.|University|Institute|Journal|Fellow|Director)/i;
  const yearBracketPattern = /[\[\(]\s*[A-Z].*?\d{2,4}\s*[\]\)]/;

  function isCiteLine(text: string): boolean {
    if (text.length > 500) return false;
    return citePattern.test(text) || yearBracketPattern.test(text) ||
      (citePattern2.test(text) && text.length < 300) ||
      (citePattern3.test(text) && text.length < 300);
  }

  function isSectionDivider(idx: number): boolean {
    const p = paragraphs[idx];
    if (p.headingLevel === 1 || p.headingLevel === 2) return true;
    if (p.headingLevel === 3) {
      for (let k = idx + 1; k < Math.min(idx + 6, paragraphs.length); k++) {
        const next = paragraphs[k];
        if (next.text.length === 0) continue;
        if (next.headingLevel === 1 || next.headingLevel === 2) return true;
        if (isCiteLine(next.text)) return false;
        if (next.headingLevel >= 3) return true;
        break;
      }
      return true;
    }
    return false;
  }

  function isTagLine(text: string, p: typeof paragraphs[0]): boolean {
    if (text.length < 3) return false;
    if (p.headingLevel >= 3) return true;
    if (text.length > 300) return false;
    if (p.isBold || p.isUnderline) return true;
    if (/^(AT[:.]?\s|A2[:.]?\s|Answer to|Answers|Impact|Link|Turn|Internal Link|Uniqueness|Nonunique|No Link|Link Turn|No Impact|Impact Turn|Contention|Shell|Frontline|Extension|1AR|1NC|2AR|2NC)/i.test(text)) return true;
    if (/^[A-Z][^.]*$/.test(text) && text.length < 100) return true;
    return false;
  }

  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];

    if (isSectionDivider(i)) {
      i++;
      continue;
    }

    if (isTagLine(p.text, p)) {
      const tag = p.text;
      let cite = "";
      let bodyParts: string[] = [];
      let j = i + 1;

      if (j < paragraphs.length && isCiteLine(paragraphs[j].text)) {
        cite = paragraphs[j].text;
        j++;
      }

      while (j < paragraphs.length) {
        const next = paragraphs[j];
        if (isSectionDivider(j)) break;
        if (isTagLine(next.text, next) && !isCiteLine(next.text)) break;
        if (isCiteLine(next.text) && bodyParts.length > 0) break;
        bodyParts.push(next.text);
        j++;
      }

      const body = bodyParts.join("\n\n");

      if (cite || body.length > 50) {
        cards.push({ tag, cite, body, isAnalytic: false });
      } else if (body.length === 0 || body.length <= 50) {
        cards.push({ tag, cite: "", body, isAnalytic: true });
      }

      i = j;
    } else {
      i++;
    }
  }

  return cards;
}

function parseAiJson(raw: string): any {
  let content = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch {}
    }
    return null;
  }
}

async function generateAiKeywordsAndTags(
  filename: string,
  sections: Array<{ heading: string; content: string }>,
  existingTags: string[]
): Promise<{ keywords: string[]; tags: string[] }> {
  try {
    const headings = sections.map((s) => s.heading).filter(Boolean).slice(0, 12).join(", ");
    const preview = sections.map((s) => s.content).join(" ").slice(0, 800);

    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [
        {
          role: "user",
          content: `You are a Public Forum Debate evidence indexer. ${DEBATE_TERMINOLOGY}

Analyze this debate file and return ONLY a JSON object with two arrays:
1. "keywords": 30 search keywords. Include:
   - Topic abbreviations and synonyms (cap good, dedev, china heg, etc.)
   - Argument-level descriptions: what specific claims does this file make? (e.g. "econ decline leads to peace", "warming causes extinction", "capitalism solves environment")
   - What this file RESPONDS TO or TURNS (e.g. if it's dedev, include "econ growth bad", "growth causes warming")
   - Impact chains mentioned (e.g. "trade war escalation nuclear")
   - Debate response types if applicable (NUQ, NL, L/T, N!, !/T)
   Think about every way a debater might search for this file.
2. "tags": 5-8 short descriptive tags (e.g. "cap good", "warming impact turn", "china heg", "dedev", "econ decline good")

File: ${filename}
Existing tags: ${existingTags.join(", ") || "none"}
Headings: ${headings}
Content: ${preview}

Return ONLY the JSON object, nothing else.`,
        },
      ],
      max_completion_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = parseAiJson(content);
    if (!parsed) {
      console.error("Failed to parse AI response:", content.slice(0, 200));
      return { keywords: [], tags: [] };
    }

    let keywords: string[] = [];
    if (Array.isArray(parsed)) {
      keywords = parsed;
    } else if (Array.isArray(parsed.keywords)) {
      keywords = parsed.keywords;
    }

    let tags: string[] = [];
    if (Array.isArray(parsed.tags)) {
      tags = parsed.tags;
    }

    return {
      keywords: keywords.map((k: string) => String(k).toLowerCase().trim()).filter(Boolean),
      tags: tags.map((t: string) => String(t).toLowerCase().trim()).filter(Boolean),
    };
  } catch (error) {
    console.error("AI keyword generation error:", error);
    return { keywords: [], tags: [] };
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

      const parsedCards = parseEvidenceCards(htmlContent);
      if (parsedCards.length > 0) {
        const cardData = parsedCards.map((c, i) => ({
          documentId: doc.id,
          tag: c.tag,
          cite: c.cite,
          body: c.body,
          cardIndex: i,
          isAnalytic: c.isAnalytic,
        }));
        await storage.createCards(cardData);
      }

      res.json({
        id: doc.id,
        originalFilename: doc.originalFilename,
        tags: doc.tags,
        uploadedAt: doc.uploadedAt,
        indexing: true,
        cardCount: parsedCards.length,
      });

      const fileRef = req.file;
      generateAiKeywordsAndTags(fileRef.originalname, parsedSections, tags).then(async ({ keywords, tags: aiTags }) => {
        const mergedTags = [...new Set([...tags, ...aiTags])];
        const searchIndex = buildSearchIndex(fileRef.originalname, mergedTags, parsedSections, keywords);
        await storage.updateDocumentTags(doc.id, mergedTags);
        await storage.updateDocumentAiData(doc.id, keywords, searchIndex);
        console.log(`Indexed document ${doc.id} (${fileRef.originalname}) with ${keywords.length} keywords and ${aiTags.length} auto-tags`);
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
            role: "user",
            content: `${DEBATE_TERMINOLOGY}

You are a PF debate evidence assistant. For each document below, write ONE sentence explaining the specific argument this file makes that's relevant to the search query. Focus on the claim chain: what does this file argue causes what? For example: "Argues economic decline reduces military spending, leading to fewer interstate conflicts" is better than "Contains evidence about economic decline". Be specific about what a debater will find.

Search: "${query}"

Documents:
${docSummary}

Return ONLY JSON: {"summaries": [{"id": number, "summary": "sentence", "sectionHint": "section name"}]}`,
          },
        ],
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = parseAiJson(content);
      let summaries: Record<number, { summary: string; sectionHint: string }> = {};
      if (parsed) {
        const arr = parsed.summaries || parsed.results || (Array.isArray(parsed) ? parsed : []);
        for (const item of arr) {
          if (item?.id) {
            summaries[item.id] = { summary: item.summary || "", sectionHint: item.sectionHint || "" };
          }
        }
      }

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
            aiKeywords: doc.aiKeywords.slice(0, 15),
            headings: sections.map((s) => s.heading).filter(Boolean).slice(0, 8),
            preview: doc.textContent.slice(0, 200),
          };
        })
      );

      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          {
            role: "user",
            content: `${DEBATE_TERMINOLOGY}

You are a PF debate search engine. Find ALL relevant documents for this search. Think about synonyms (dedev=degrowth, cap=capitalism, heg=hegemony, china rise=china heg), arguments that RESPOND TO the concept, impact chains, and debate abbreviations.

Search: "${query}"

Library:
${docSummaries.map((d) => `ID:${d.id}|${d.filename}|Tags:${d.tags.join(",")}|Keywords:${d.aiKeywords.join(",")}|Headings:${d.headings.join(",")}`).join("\n")}

Return ONLY JSON: {"results": [{"id": number, "relevance": "one sentence", "sectionHint": "section name"}]}
Order by relevance. Only include truly relevant docs.`,
          },
        ],
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = parseAiJson(content);
      let aiResults: Array<{ id: number; relevance: string; sectionHint: string }> = [];
      if (parsed) {
        aiResults = parsed.results || (Array.isArray(parsed) ? parsed : []);
      }

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
        return res.json({ contentions: [], responses: [] });
      }

      const docSummaries = await Promise.all(
        allDocs.slice(0, 30).map(async (doc) => {
          const sections = await storage.getSectionsByDocumentId(doc.id);
          return {
            id: doc.id,
            filename: doc.originalFilename,
            tags: doc.tags,
            aiKeywords: doc.aiKeywords.slice(0, 15),
            sectionHeadings: sections.map((s) => s.heading).filter(Boolean).slice(0, 10),
            contentPreview: doc.textContent.slice(0, 400),
          };
        })
      );

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          {
            role: "user",
            content: `${DEBATE_TERMINOLOGY}

You are a PF debate case analyzer. Break down this opponent's case into its argument structure, then find responses from my evidence library.

STEP 1: Break down each contention into its structure:
- What is the Uniqueness (UQ)? What's the current state of the world?
- What is the Link (L)? How does the resolution connect?
- What are the Internal Links (IL)? The chain of consequences?
- What is the terminal Impact (!)? The final bad/good thing?

STEP 2: For EACH part of their argument chain, find responses from my evidence library. Types of responses:
- NUQ (Nonunique): Evidence showing the impact is already happening
- NL (No Link): Evidence showing the resolution doesn't cause this
- L/T (Link Turn): Evidence showing the resolution actually does the OPPOSITE
- N! (No Impact): Evidence showing the consequence doesn't actually matter
- !/T (Impact Turn): Evidence showing the "bad" thing is actually GOOD
- General responses: Any evidence that challenges their argument

OPPONENT'S CASE:
${plainText.slice(0, 5000)}

MY EVIDENCE LIBRARY:
${docSummaries.map((d) => `ID:${d.id}|${d.filename}|Tags:${d.tags.join(",")}|Keywords:${d.aiKeywords.join(",")}|Sections:${d.sectionHeadings.join(",")}`).join("\n")}

Return ONLY JSON with this structure:
{
  "contentions": [
    {
      "name": "Contention name/title",
      "summary": "One sentence summary",
      "structure": {
        "uniqueness": "What they claim about the status quo",
        "link": "How the resolution connects",
        "internalLinks": ["chain step 1", "chain step 2"],
        "impact": "Terminal impact"
      }
    }
  ],
  "responses": [
    {
      "targetContention": "Which contention this responds to",
      "responseType": "NUQ|NL|L/T|N!|!/T|General",
      "responseLabel": "Short label like 'Link Turn - Econ Growth'",
      "explanation": "One sentence explanation of how this responds",
      "contentionIndex": 0-based index matching the contentions array,
      "docId": number,
      "docFilename": "filename",
      "sectionHint": "which section to look at"
    }
  ]
}

IMPORTANT: contentionIndex MUST be a 0-based integer matching the contentions array index. If a response applies to contention 1, use contentionIndex: 0. Only use real docId values from the MY EVIDENCE LIBRARY list above. If no matching doc exists, use docId: 0 and docFilename: "No match in library".`,
          },
        ],
        max_completion_tokens: 8192,
      });

      const aiContent = aiResponse.choices[0]?.message?.content || "{}";
      const parsed = parseAiJson(aiContent);
      cleanupFile(filePath);

      if (!parsed) {
        return res.json({ contentions: [], responses: [], caseText: plainText.slice(0, 2000) });
      }

      const validDocIds = new Set(allDocs.map((d) => d.id));
      const validatedResponses = (parsed.responses || []).map((r: any) => ({
        ...r,
        contentionIndex: typeof r.contentionIndex === "number" ? r.contentionIndex : 0,
        docId: validDocIds.has(r.docId) ? r.docId : 0,
        docFilename: validDocIds.has(r.docId) ? r.docFilename : (r.docFilename || "No match in library"),
      }));

      res.json({
        contentions: parsed.contentions || [],
        responses: validatedResponses,
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
      const { keywords, tags: aiTags } = await generateAiKeywordsAndTags(doc.originalFilename, parsedSections, doc.tags);
      const mergedTags = [...new Set([...doc.tags, ...aiTags])];
      await storage.updateDocumentTags(doc.id, mergedTags);
      const searchIndex = buildSearchIndex(doc.originalFilename, mergedTags, parsedSections, keywords);
      await storage.updateDocumentAiData(doc.id, keywords, searchIndex);

      res.json({ success: true, keywords: keywords.length, tags: aiTags.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Reindex failed" });
    }
  });

  app.post("/api/documents/:id/reparse-cards", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });

      const filePath = path.join(uploadDir, doc.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }

      const result = await mammoth.convertToHtml({ path: filePath });
      const htmlContent = result.value;
      const parsedCards = parseEvidenceCards(htmlContent);

      await storage.deleteCardsByDocumentId(doc.id);

      if (parsedCards.length > 0) {
        const cardData = parsedCards.map((c, i) => ({
          documentId: doc.id,
          tag: c.tag,
          cite: c.cite,
          body: c.body,
          cardIndex: i,
          isAnalytic: c.isAnalytic,
        }));
        await storage.createCards(cardData);
      }

      res.json({ success: true, cardCount: parsedCards.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Re-parse failed" });
    }
  });

  app.get("/api/documents/:id/cards", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const cards = await storage.getCardsByDocumentId(doc.id);
      res.json({ document: { id: doc.id, originalFilename: doc.originalFilename, tags: doc.tags }, cards });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch cards" });
    }
  });

  app.patch("/api/cards/:id/signature", async (req, res) => {
    try {
      const updates: Partial<{ customTag: string | null; customCite: string | null }> = {};
      if ("customTag" in req.body) updates.customTag = req.body.customTag;
      if ("customCite" in req.body) updates.customCite = req.body.customCite;
      const updated = await storage.updateCardSignaturePartial(
        parseInt(req.params.id),
        updates
      );
      if (!updated) return res.status(404).json({ error: "Card not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update card" });
    }
  });

  app.post("/api/search/cards", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ error: "Search query is required" });
      }
      const results = await storage.searchCards(query.trim());
      res.json({
        results: results.map((r) => ({
          card: r.card,
          document: {
            id: r.doc.id,
            originalFilename: r.doc.originalFilename,
            tags: r.doc.tags,
          },
          rank: r.rank,
          sectionHeading: r.sectionHeading || null,
        })),
      });
    } catch (error: any) {
      console.error("Card search error:", error);
      res.status(500).json({ error: "Card search failed" });
    }
  });

  app.post("/api/documents/reparse-all-cards", async (req, res) => {
    try {
      const allDocs = await storage.getAllDocuments();
      const results: Array<{ id: number; filename: string; cardCount: number }> = [];

      for (const doc of allDocs) {
        const filePath = path.join(uploadDir, doc.filename);
        if (!fs.existsSync(filePath)) continue;

        try {
          const result = await mammoth.convertToHtml({ path: filePath });
          const parsedCards = parseEvidenceCards(result.value);
          await storage.deleteCardsByDocumentId(doc.id);

          if (parsedCards.length > 0) {
            const cardData = parsedCards.map((c, i) => ({
              documentId: doc.id,
              tag: c.tag,
              cite: c.cite,
              body: c.body,
              cardIndex: i,
              isAnalytic: c.isAnalytic,
            }));
            await storage.createCards(cardData);
          }
          results.push({ id: doc.id, filename: doc.originalFilename, cardCount: parsedCards.length });
        } catch (e) {
          results.push({ id: doc.id, filename: doc.originalFilename, cardCount: -1 });
        }
      }

      res.json({ success: true, documents: results, total: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Reparse all failed" });
    }
  });

  app.get("/api/documents/:id/download-section", async (req, res) => {
    try {
      const doc = await storage.getDocument(parseInt(req.params.id));
      if (!doc) return res.status(404).json({ error: "Document not found" });

      const heading = req.query.heading as string;
      if (!heading) return res.status(400).json({ error: "heading query param required" });

      const filePath = path.join(uploadDir, doc.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }

      const fileBuffer = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(fileBuffer);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      if (!documentXml) {
        return res.status(500).json({ error: "Invalid docx format" });
      }

      const normalizedHeading = heading.toLowerCase().replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim();

      const bodyChildPattern = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
      const allParagraphs = documentXml.match(bodyChildPattern) || [];

      function extractText(pXml: string): string {
        const textMatches = pXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return textMatches.map(t => t.replace(/<[^>]*>/g, "")).join("").trim();
      }

      function getHeadingLevel(pXml: string): number | null {
        const styleMatch = pXml.match(/<w:pStyle w:val="([^"]*?)"/);
        if (!styleMatch) return null;
        const style = styleMatch[1].toLowerCase();
        const headingMatch = style.match(/heading(\d)/);
        if (headingMatch) return parseInt(headingMatch[1]);
        if (style === "title") return 1;
        return null;
      }

      let sectionStart = -1;
      let sectionLevel = 0;

      for (let i = 0; i < allParagraphs.length; i++) {
        const text = extractText(allParagraphs[i]).toLowerCase().replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim();
        const level = getHeadingLevel(allParagraphs[i]);
        if (level && text.includes(normalizedHeading)) {
          sectionStart = i;
          sectionLevel = level;
          break;
        }
        if (!level && text === normalizedHeading) {
          sectionStart = i;
          sectionLevel = 99;
          break;
        }
      }

      if (sectionStart === -1) {
        for (let i = 0; i < allParagraphs.length; i++) {
          const text = extractText(allParagraphs[i]).toLowerCase().replace(/[:\-–—]/g, " ").replace(/\s+/g, " ").trim();
          if (text.includes(normalizedHeading)) {
            sectionStart = i;
            const level = getHeadingLevel(allParagraphs[i]);
            sectionLevel = level || 99;
            break;
          }
        }
      }

      if (sectionStart === -1) {
        return res.status(404).json({ error: "Section not found in document" });
      }

      let sectionEnd = allParagraphs.length;
      let foundContent = false;
      for (let i = sectionStart + 1; i < allParagraphs.length; i++) {
        const level = getHeadingLevel(allParagraphs[i]);
        const text = extractText(allParagraphs[i]);
        if (!level && text.length > 0) foundContent = true;
        if (level && level <= sectionLevel && foundContent) {
          sectionEnd = i;
          break;
        }
        if (level && level < sectionLevel) {
          sectionEnd = i;
          break;
        }
      }

      if (!foundContent) {
        let contentStart = sectionStart - 1;
        let foundBody = false;
        while (contentStart >= 0) {
          const level = getHeadingLevel(allParagraphs[contentStart]);
          const text = extractText(allParagraphs[contentStart]);
          if (!level && text.length > 20) {
            foundBody = true;
          }
          if (level && level < sectionLevel) {
            sectionStart = contentStart;
            break;
          }
          if (foundBody && level && level <= sectionLevel) {
            sectionStart = contentStart;
            break;
          }
          contentStart--;
        }
        if (contentStart < 0) sectionStart = 0;

        sectionEnd = allParagraphs.length;
        for (let i = sectionStart + 1; i < allParagraphs.length; i++) {
          const lvl = getHeadingLevel(allParagraphs[i]);
          if (lvl && lvl < sectionLevel) {
            sectionEnd = i;
            break;
          }
        }
      }

      const sectionParagraphs = allParagraphs.slice(sectionStart, sectionEnd);
      const bodyContent = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/);
      if (!bodyContent) {
        return res.status(500).json({ error: "Cannot parse document body" });
      }

      const existingSectPr = bodyContent[1].match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
      const sectPr = existingSectPr ? existingSectPr[0] : "<w:sectPr/>";
      const newBody = `<w:body>${sectionParagraphs.join("")}${sectPr}</w:body>`;
      const newDocXml = documentXml.replace(/<w:body>[\s\S]*<\/w:body>/, newBody);

      const newZip = new JSZip();
      for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) {
          newZip.folder(zipPath);
        } else if (zipPath === "word/document.xml") {
          newZip.file(zipPath, newDocXml);
        } else {
          const content = await zipEntry.async("uint8array");
          newZip.file(zipPath, content);
        }
      }

      const outputBuffer = await newZip.generateAsync({ type: "nodebuffer" });
      const sanitizedHeading = heading.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const outputFilename = `${sanitizedHeading}_from_${doc.originalFilename}`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(outputFilename)}"`);
      res.send(outputBuffer);
    } catch (error: any) {
      console.error("Section download error:", error);
      res.status(500).json({ error: error.message || "Section download failed" });
    }
  });

  return httpServer;
}
