/**
 * Copy all .docx from test-files/ into uploads/ with original naming preserved.
 * Names include folder path (e.g. "AFF copy - February 2026---Civil War AFF---Manan.docx")
 * so every test file lives in one folder (uploads) without changing names. Skips ~$ temp files.
 *
 * Run: npm run copy:test-to-uploads
 */
import path from "path";
import fs from "fs";

const TEST_FILES_DIR = path.resolve("test-files");
const UPLOADS_DIR = path.resolve("uploads");

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
  return relativePath.replace(/\//g, " - ");
}

function main() {
  if (!fs.existsSync(TEST_FILES_DIR)) {
    console.error("test-files/ not found.");
    process.exit(1);
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const toCopy = [...walkDocx(TEST_FILES_DIR, TEST_FILES_DIR)];
  if (toCopy.length === 0) {
    console.log("No .docx files in test-files/ (excluding ~$ temp files).");
    return;
  }

  let copied = 0;
  for (const { absolute, relative } of toCopy) {
    const name = pathToDisplayName(relative);
    const dest = path.join(UPLOADS_DIR, name);
    try {
      fs.copyFileSync(absolute, dest);
      console.log(`  + ${name}`);
      copied++;
    } catch (e: any) {
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  console.log(`\nCopied ${copied} files from test-files/ → uploads/ (original naming preserved).`);
}

main();
