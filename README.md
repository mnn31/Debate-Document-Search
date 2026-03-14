# PF Vault

**PF Vault** is a debate evidence manager for Public Forum. Upload **.docx** evidence, get parsed sections and cards, **search** by keyword and AI, manage your **library**, and use an **opponent case** flow to get response suggestions and export .docx.

---

## What it does

- **Upload evidence** — Add .docx files. The app parses them into sections (by headings) and evidence cards (TAG / CITE / BODY). With an OpenAI API key, each document gets ~30 AI keywords and 5–8 tags for better search.
- **Search** — Keyword search (instant) plus optional AI semantic search (e.g. “cap good”, “dedev”, “!/T”). Results show matching sections; you can download the full file or a single section as .docx.
- **Library** — See all documents, edit tags, re-index (regenerate AI keywords/tags), view cards, download.
- **Opponent case** — Paste or upload the opponent’s case. The AI breaks it into contentions and UQ → Link → Internal Link → Impact, suggests response types (NUQ, NL, L/T, N!, !/T), finds matching evidence from your library, and lets you export selected responses as one .docx.

All AI features (keywords, tags, semantic search, opponent analysis) are **optional**: if you don’t set an API key, the app still runs with keyword-only search.

---

## How to use the website

After you run the app and open it in the browser:

| Page | What to do |
|------|------------|
| **Search** (home) | Type a query (e.g. “cap good”, “nuclear war”). Use quick chips for common topics. Results show document name, tags, and matching sections. Click a result to open the document page or use “Download full” / “Download section”. |
| **Library** | View all uploaded documents. Click a row to open the document, use “Download”, “Re-index” (regenerate AI keywords/tags), or “Delete”. Edit tags in the sidebar. |
| **Upload** | Drag and drop or select .docx files. They are parsed and (with an API key) indexed with AI keywords and tags. |
| **Opponent** | Paste the opponent’s case text or upload a .docx. Click analyze. Review contentions, response suggestions, and matched evidence cards. Select responses and “Download responses” to get a single .docx. |
| **Document** (from Search or Library) | See all evidence cards for that file. Download the full file or individual sections. Edit card “recut” signatures if needed. |

---

## Quick start

1. **Environment**  
   Copy `.env.example` to `.env` and set:
   - `DATABASE_URL` — PostgreSQL connection string (required).
   - `OPENAI_API_KEY` — Your OpenAI API key (optional; enables AI indexing, semantic search, opponent case).

2. **Verify OpenAI key (optional)**  
   ```bash
   npm run verify:openai
   ```  
   If the key is valid, you’ll see: `OpenAI API key is valid. Model: gpt-4o-mini`.

3. **Database and seed**  
   ```bash
   npm install
   npm run db:push
   npm run seed
   ```  
   `seed` loads all .docx from `preload-files/` into the app (and runs AI indexing if the key is set).

4. **Put test files in one folder (uploads)**  
   To copy everything from `test-files/` into `uploads/` **without changing their names** (folder path becomes part of the filename, e.g. `AFF copy - February 2026---Civil War AFF---Manan.docx`):
   ```bash
   npm run copy:test-to-uploads
   ```  
   To also refresh `preload-files/` from `test-files/` and then seed so the app shows those names:
   ```bash
   npm run preload:sync
   npm run seed
   ```

5. **Run the app**  
   ```bash
   npm run dev
   ```  
   Open **http://127.0.0.1:5000** (or the URL shown in the terminal).

---

## Scripts reference

| Command | Description |
|--------|-------------|
| `npm run dev` | Start the app (server + frontend). |
| `npm run db:push` | Create/update database tables. |
| `npm run seed` | Load .docx from `preload-files/` into the app; files are stored in `uploads/` with the same naming. |
| `npm run preload:sync` | Copy `test-files/` → `preload-files/` with path-based names (e.g. `AFF copy - File.docx`). Then run `seed` to load into the app. |
| `npm run copy:test-to-uploads` | Copy all .docx from `test-files/` into `uploads/` with original (path-based) naming. Every test file ends up in one folder (`uploads/`) without renaming. |
| `npm run verify:openai` | Check that `OPENAI_API_KEY` in `.env` is set and works. |

---

## Folders

- **`test-files/`** — Your evidence organized in folders (e.g. AFF copy, NEG copy). Temp files (`~$...`) are ignored.
- **`preload-files/`** — Used by `seed`. After `preload:sync`, contains path-named copies from `test-files/`.
- **`uploads/`** — All stored .docx in one folder. Names match preload/test-files (e.g. `AFF copy - File.docx`). Do not commit (gitignored).

---

## More details

- **RUN.md** — Full run instructions, API key, database options, and what the AI does.
- **REPLIT.md** — How to run PF Vault on Replit.
