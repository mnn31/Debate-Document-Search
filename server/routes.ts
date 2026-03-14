import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import OpenAI from "openai";
import JSZip from "jszip";
import { storage } from "./storage";
import { parseDocxSections, parseEvidenceCards, type ParsedCard } from "./parseDocx";

const openai: OpenAI | null =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      })
    : null;

function getOpenAI(): OpenAI {
  if (!openai) throw new Error("AI not configured. Set OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY.");
  return openai;
}

const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
    const truncFix = repairTruncatedJson(content);
    if (truncFix) return truncFix;
    return null;
  }
}

function repairTruncatedJson(raw: string): any {
  let s = raw.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const idx = s.indexOf("{");
    if (idx < 0) return null;
    s = s.slice(idx);
  }
  for (let attempts = 0; attempts < 20; attempts++) {
    try { return JSON.parse(s); } catch {}
    const lastOpen = Math.max(s.lastIndexOf("{"), s.lastIndexOf("["));
    const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (lastOpen > lastClose) {
      s = s.slice(0, lastOpen);
    } else {
      s = s.slice(0, lastClose);
    }
    let opens = 0, closes = 0;
    for (const c of s) {
      if (c === "{" || c === "[") opens++;
      if (c === "}" || c === "]") closes++;
    }
    while (closes < opens) {
      const lastBrace = s.lastIndexOf("{");
      const lastBrack = s.lastIndexOf("[");
      if (lastBrace > lastBrack) {
        s += "}";
      } else {
        s += "]";
      }
      closes++;
    }
  }
  return null;
}

export async function generateAiKeywordsAndTags(
  filename: string,
  sections: Array<{ heading: string; content: string }>,
  existingTags: string[]
): Promise<{ keywords: string[]; tags: string[] }> {
  try {
    const headings = sections.map((s) => s.heading).filter(Boolean).slice(0, 12).join(", ");
    const preview = sections.map((s) => s.content).join(" ").slice(0, 800);

    const response = await getOpenAI().chat.completions.create({
      model: openaiModel,
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

export function buildSearchIndex(
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
          sectionHeading: c.sectionHeading,
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

      const response = await getOpenAI().chat.completions.create({
        model: openaiModel,
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

      const response = await getOpenAI().chat.completions.create({
        model: openaiModel,
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

      const opponentCards = parseEvidenceCards(htmlContent);
      const sectionGroups: Map<string, string[]> = new Map();
      for (const card of opponentCards) {
        const section = card.sectionHeading || "General";
        if (!sectionGroups.has(section)) sectionGroups.set(section, []);
        sectionGroups.get(section)!.push(card.tag.slice(0, 120));
      }

      let caseSummary = "";
      if (opponentCards.length >= 2) {
        for (const [section, tags] of sectionGroups) {
          caseSummary += `\n== ${section}\n`;
          tags.forEach((t, i) => { caseSummary += `  Card ${i + 1}: ${t}\n`; });
        }
        caseSummary = caseSummary.slice(0, 8000);
      } else {
        const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        caseSummary = plainText.slice(0, 8000);
      }
      console.log("OPPONENT CASE PARSED:", opponentCards.length, "cards in", sectionGroups.size, "sections");

      const allDocs = await storage.getAllDocuments();
      if (allDocs.length === 0) {
        cleanupFile(filePath);
        return res.json({ contentions: [], responses: [], responsePaths: [] });
      }

      const docSummaries = await Promise.all(
        allDocs.slice(0, 30).map(async (doc) => {
          const cards = await storage.getCardsByDocumentId(doc.id);
          const uniqueSections = [...new Set(cards.map((c) => c.sectionHeading).filter(Boolean))];
          return {
            id: doc.id,
            filename: doc.originalFilename,
            sections: uniqueSections.slice(0, 15),
            cardCount: cards.length,
          };
        })
      );

      const libSummary = docSummaries.map((d) =>
        `${d.filename} (${d.cardCount} cards) | Sections: ${d.sections.join(", ")}`
      ).join("\n");

      const aiResponse = await getOpenAI().chat.completions.create({
        model: openaiModel,
        messages: [
          {
            role: "user",
            content: `${DEBATE_TERMINOLOGY}

You are a PF debate case analyzer. The opponent's case has been parsed into section headings and card tags.

TASK 1: Identify ALL contentions/advantages/disadvantages. Each section heading like "1AC---Crypto ADV" is a separate contention. For each, trace UQ → Link(s) → Internal Link(s) → Impact using the card tags.

TASK 2: For each contention, suggest UP TO 5 key responses. Types: NUQ, NL, L/T, N!, !/T.
CRITICAL FOR searchQuery: Look at my library filenames and card tags. Pick the MOST RELEVANT ones.
- If opponent says "Golden Dome bad", search "Golden Dome Good" (my library has that file!)
- If opponent's impact is nuclear war, search "Nuclear War Good" or "Wipeout" 
- If opponent says "crypto regulation bad", search cards about crypto regulation benefits
- NEVER use generic terms like "No Link" or "Impact Turn" as searchQuery — use SPECIFIC topic words from my library

TASK 3: Group into 2-3 responsePaths. CRITICAL: L/T + !/T on SAME contention = double turn (FORBIDDEN).

OPPONENT'S CASE:
${caseSummary}

MY LIBRARY:
${libSummary}

Return ONLY valid JSON:
{"contentions":[{"name":"name","summary":"sentence","structure":{"uniqueness":"squo","links":["L1"],"internalLinks":["IL1"],"impact":"terminal"}}],"responses":[{"contentionIndex":0,"targetPart":"uniqueness|link|internalLink|impact","targetPartIndex":0,"responseType":"NUQ|NL|L/T|N!|!/T","responseLabel":"label","explanation":"why","searchQuery":"specific topic words from library"}],"responsePaths":[{"name":"name","description":"desc","responseIndices":[0,1]}]}`,
          },
        ],
        max_completion_tokens: 16384,
      });

      const aiContent = aiResponse.choices[0]?.message?.content || "{}";
      console.log("AI RAW (first 500):", aiContent.slice(0, 500));
      const parsed = parseAiJson(aiContent);
      console.log("PARSED:", parsed ? "OK" : "FAILED", "contentions:", parsed?.contentions?.length, "responses:", parsed?.responses?.length);
      cleanupFile(filePath);

      if (!parsed || !parsed.contentions?.length) {
        return res.json({ contentions: [], responses: [], responsePaths: [], caseText: caseSummary.slice(0, 2000) });
      }

      const validDocIds = new Set(allDocs.map((d) => d.id));
      const docMap = new Map(allDocs.map((d) => [d.id, d]));

      const enrichedResponses = await Promise.all(
        (parsed.responses || []).map(async (r: any, idx: number) => {
          const searchQuery = r.searchQuery || r.responseLabel || "";
          let cards: Array<{ card: any; doc: any; rank: number; sectionHeading: string | null }> = [];

          if (searchQuery) {
            try {
              cards = await storage.searchCards(searchQuery);
            } catch (e) {}
          }

          if (cards.length === 0 && r.sectionHint) {
            try {
              cards = await storage.searchCards(r.sectionHint);
            } catch (e) {}
          }

          const topCards = cards.slice(0, 3).map((c) => ({
            cardId: c.card.id,
            documentId: c.card.documentId,
            tag: c.card.customTag || c.card.tag,
            cite: c.card.customCite || c.card.cite,
            body: c.card.body?.slice(0, 300) || "",
            sectionHeading: c.sectionHeading || c.card.sectionHeading,
            docFilename: c.doc.originalFilename,
            rank: c.rank,
          }));

          return {
            contentionIndex: typeof r.contentionIndex === "number" ? r.contentionIndex : 0,
            targetPart: r.targetPart || "general",
            targetPartIndex: typeof r.targetPartIndex === "number" ? r.targetPartIndex : 0,
            responseType: r.responseType || "General",
            responseLabel: r.responseLabel || "",
            explanation: r.explanation || "",
            searchQuery,
            docId: validDocIds.has(r.docId) ? r.docId : (topCards.length > 0 ? topCards[0].documentId : 0),
            docFilename: validDocIds.has(r.docId)
              ? (docMap.get(r.docId)?.originalFilename || r.docFilename || "")
              : (topCards.length > 0 ? topCards[0].docFilename : "No match"),
            sectionHint: r.sectionHint || (topCards.length > 0 ? topCards[0].sectionHeading : ""),
            cards: topCards,
          };
        })
      );

      const responsePaths = (parsed.responsePaths || []).map((p: any) => ({
        name: p.name || "Unnamed Path",
        description: p.description || "",
        responseIndices: Array.isArray(p.responseIndices) ? p.responseIndices.filter((i: any) => typeof i === "number" && i < enrichedResponses.length) : [],
      })).filter((path: any) => {
        const pathResponses = path.responseIndices.map((i: number) => enrichedResponses[i]).filter(Boolean);
        const contentionGroups = new Map<number, Set<string>>();
        for (const r of pathResponses) {
          if (!contentionGroups.has(r.contentionIndex)) contentionGroups.set(r.contentionIndex, new Set());
          contentionGroups.get(r.contentionIndex)!.add(r.responseType);
        }
        for (const [, types] of contentionGroups) {
          if (types.has("L/T") && types.has("!/T")) return false;
        }
        return true;
      });

      res.json({
        contentions: parsed.contentions || [],
        responses: enrichedResponses,
        responsePaths,
        caseText: caseSummary.slice(0, 2000),
      });
    } catch (error: any) {
      console.error("Analyze error:", error);
      if (req.file) cleanupFile(req.file.path);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  app.post("/api/download-responses", async (req, res) => {
    try {
      const { responses, contentions, pathName } = req.body;
      if (!responses || !Array.isArray(responses)) {
        return res.status(400).json({ error: "No responses provided" });
      }

      const zip = new JSZip();
      let xmlParagraphs = "";

      xmlParagraphs += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(`Case Analysis Responses${pathName ? ` — ${pathName}` : ""}`)}</w:t></w:r></w:p>`;

      const responsesByContention: Record<number, any[]> = {};
      for (const r of responses) {
        const ci = r.contentionIndex || 0;
        if (!responsesByContention[ci]) responsesByContention[ci] = [];
        responsesByContention[ci].push(r);
      }

      for (const [ciStr, contResponses] of Object.entries(responsesByContention)) {
        const ci = parseInt(ciStr);
        const contentionName = contentions?.[ci]?.name || `Contention ${ci + 1}`;

        xmlParagraphs += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(contentionName)}</w:t></w:r></w:p>`;

        for (const r of contResponses) {
          xmlParagraphs += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(r.responseType)}: ${escapeXml(r.responseLabel)}</w:t></w:r></w:p>`;
          xmlParagraphs += `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>${escapeXml(r.explanation || "")}</w:t></w:r></w:p>`;

          if (r.cards && Array.isArray(r.cards)) {
            for (const card of r.cards) {
              xmlParagraphs += `<w:p><w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>${escapeXml(card.tag || "")}</w:t></w:r></w:p>`;
              if (card.cite) {
                xmlParagraphs += `<w:p><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>${escapeXml(card.cite)}</w:t></w:r></w:p>`;
              }
              if (card.body) {
                const bodyText = card.body.length > 800 ? card.body.slice(0, 800) + "..." : card.body;
                xmlParagraphs += `<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${escapeXml(bodyText)}</w:t></w:r></w:p>`;
              }
              xmlParagraphs += `<w:p><w:r><w:t> </w:t></w:r></w:p>`;
            }
          }
        }
      }

      const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mo="http://schemas.microsoft.com/office/mac/office/2008/main"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:mv="urn:schemas-microsoft-com:mac:vml"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14">
  <w:body>${xmlParagraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

      const outZip = new JSZip();
      outZip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
      outZip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
      outZip.file("word/document.xml", docXml);
      outZip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

      const buffer = await outZip.generateAsync({ type: "nodebuffer" });
      const safeName = pathName ? pathName.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 50) : "responses";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="Case_Responses_${safeName}.docx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Download responses error:", error);
      res.status(500).json({ error: error.message || "Download failed" });
    }
  });

  function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

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
          sectionHeading: c.sectionHeading,
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
              sectionHeading: c.sectionHeading,
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
