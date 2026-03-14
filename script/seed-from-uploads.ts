/**
 * Preload the database from preload-files/ (all .docx).
 * Copies each file into uploads/, creates document + sections + cards, then runs AI indexing if OPENAI_API_KEY is set.
 * Run: npm run seed   (after setting DATABASE_URL and optionally OPENAI_API_KEY in .env)
 */
import "dotenv/config";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import { storage } from "../server/storage";
import { parseDocxSections, parseEvidenceCards } from "../server/parseDocx";
import { generateAiKeywordsAndTags, buildSearchIndex } from "../server/routes";

const PRELOAD_DIR = path.resolve("preload-files");
const UPLOADS_DIR = path.resolve("uploads");

function uniqueFilename(originalName: string): string {
  const ext = path.extname(originalName) || ".docx";
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required. Set it in .env or export it.");
    process.exit(1);
  }

  if (!fs.existsSync(PRELOAD_DIR)) {
    console.error("preload-files/ directory not found. Create it and add .docx files.");
    process.exit(1);
  }

  const files = fs.readdirSync(PRELOAD_DIR)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();
  if (files.length === 0) {
    console.log("No .docx files in preload-files/.");
    return;
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const existing = await storage.getAllDocuments();
  const existingOriginal = new Set(existing.map((d) => d.originalFilename));

  let added = 0;
  let skipped = 0;
  const runAi = !!(
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  );
  if (runAi) {
    console.log("AI indexing enabled (OPENAI_API_KEY set). Indexing each document after add.\n");
  } else {
    console.log("OPENAI_API_KEY not set. Skipping AI keywords/tags. Set it in .env to enable.\n");
  }

  for (const originalName of files) {
    if (existingOriginal.has(originalName)) {
      skipped++;
      continue;
    }
    const srcPath = path.join(PRELOAD_DIR, originalName);
    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) continue;

    const storageFilename = uniqueFilename(originalName);
    const destPath = path.join(UPLOADS_DIR, storageFilename);
    try {
      fs.copyFileSync(srcPath, destPath);
    } catch (e: any) {
      console.error(`  ✗ ${originalName}: copy failed - ${e.message}`);
      continue;
    }

    try {
      const result = await mammoth.convertToHtml({ path: destPath });
      const htmlContent = result.value;
      const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const parsedSections = parseDocxSections(htmlContent);

      const doc = await storage.createDocument({
        filename: storageFilename,
        originalFilename: originalName,
        tags: [],
        textContent: plainText,
        aiKeywords: [],
        searchIndex: originalName.replace(/\.docx$/i, "").replace(/[_-]/g, " ").toLowerCase(),
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

      existingOriginal.add(originalName);
      added++;
      console.log(`  + ${originalName} (id ${doc.id}, ${parsedSections.length} sections, ${parsedCards.length} cards)`);

      if (runAi) {
        try {
          const { keywords, tags: aiTags } = await generateAiKeywordsAndTags(originalName, parsedSections, []);
          const mergedTags = [...new Set(aiTags)];
          const searchIndex = buildSearchIndex(originalName, mergedTags, parsedSections, keywords);
          await storage.updateDocumentTags(doc.id, mergedTags);
          await storage.updateDocumentAiData(doc.id, keywords, searchIndex);
          console.log(`    → AI indexed: ${keywords.length} keywords, ${aiTags.length} tags`);
        } catch (aiErr: any) {
          console.error(`    → AI indexing failed: ${aiErr.message}`);
        }
      }
    } catch (err: any) {
      console.error(`  ✗ ${originalName}: ${err.message}`);
      try { fs.unlinkSync(destPath); } catch {}
    }
  }

  console.log(`\nDone. Added ${added}, skipped ${skipped} (already in DB).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
