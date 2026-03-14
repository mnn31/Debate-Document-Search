/**
 * Sync test-files/ → preload-files/ with original naming preserved.
 * Each file is copied with a name that includes its folder path so you see
 * names like "AFF copy - February 2026---Civil War AFF---Manan.docx" instead
 * of generic or duplicate basenames. Excludes temp files (~$*.docx).
 *
 * Run: npm run preload:sync
 * Then: npm run seed   (to load into the app with these display names)
 */
import path from "path";
import fs from "fs";

const TEST_FILES_DIR = path.resolve("test-files");
const PRELOAD_DIR = path.resolve("preload-files");

function isTempFile(name: string): boolean {
  return name.startsWith("~$");
}

function* walkDocx(dir: string, baseDir: string): Generator<{ absolute: string; relative: string }> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(baseDir, full);
    if (e.isDirectory()) {
      yield* walkDocx(full, baseDir);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".docx") && !isTempFile(e.name)) {
      yield { absolute: full, relative: rel };
    }
  }
}

function pathToDisplayName(relativePath: string): string {
  // Preserve folder structure in the filename: "AFF copy/File.docx" → "AFF copy - File.docx"
  return relativePath.replace(/\//g, " - ");
}

function main() {
  if (!fs.existsSync(TEST_FILES_DIR)) {
    console.error("test-files/ not found.");
    process.exit(1);
  }
  if (!fs.existsSync(PRELOAD_DIR)) {
    fs.mkdirSync(PRELOAD_DIR, { recursive: true });
  }

  const toCopy = [...walkDocx(TEST_FILES_DIR, TEST_FILES_DIR)];
  if (toCopy.length === 0) {
    console.log("No .docx files in test-files/ (excluding ~$ temp files).");
    return;
  }

  // Remove only .docx files from preload-files so we replace with path-preserving names from test-files
  const existing = fs.readdirSync(PRELOAD_DIR);
  for (const f of existing) {
    if (f.toLowerCase().endsWith(".docx")) {
      try {
        fs.unlinkSync(path.join(PRELOAD_DIR, f));
      } catch (e) {
        // ignore
      }
    }
  }

  let copied = 0;
  for (const { absolute, relative } of toCopy) {
    const displayName = pathToDisplayName(relative);
    const dest = path.join(PRELOAD_DIR, displayName);
    try {
      fs.copyFileSync(absolute, dest);
      console.log(`  + ${displayName}`);
      copied++;
    } catch (e: any) {
      console.error(`  ✗ ${displayName}: ${e.message}`);
    }
  }

  console.log(`\nSynced ${copied} files from test-files/ → preload-files/ (original folder names preserved).`);
  console.log("Run: npm run seed   to load these into the app.");
}

main();
