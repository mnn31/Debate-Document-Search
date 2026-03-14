# How to run PF Vault

## What is PF Vault?

**PF Vault** is a debate evidence manager for Public Forum. You upload **.docx** evidence files; the app parses them into sections and evidence cards (TAG / CITE / BODY). You get **keyword + optional AI semantic search** (e.g. “cap good”, “dedev”, “!/T”), can **download** full files or individual sections, manage an **evidence library** (edit tags, re-index, view cards), and use an **opponent case** flow: paste the opponent’s case → AI breaks it into UQ / L / IL / ! and suggests responses (NUQ, NL, L/T, N!, !/T) from your library, then export responses as .docx.

---

## What the AI is doing

- **On upload (or when you run seed with an API key):** For each document, the app asks OpenAI for ~30 **keywords** and 5–8 **tags** (debate-aware: abbreviations, impact chains, response types). Those are stored and used to build the **search index** so keyword search is fast and relevant.
- **Semantic search:** When you search, your query can be sent to OpenAI to match against document metadata (filenames, tags, headings). The AI returns relevant docs and optional section hints, using debate synonyms (e.g. cap good, dedev, china heg).
- **AI enhance:** After keyword results, the app can optionally ask the AI for short per-doc summaries.
- **Opponent case:** The pasted case is sent to OpenAI to structure it (contentions, UQ → Link → Internal Link → Impact), suggest response types and **search queries**, then the app finds matching evidence cards in your library and lets you export response docs.

All of this is **optional** if you don’t set `OPENAI_API_KEY`: the app still runs; you get keyword-only search and no auto-tags/keywords until you add a key.

---

## 1. API key (OpenAI)

**Where to put it:** In a file named **`.env`** in the **project root** (same folder as `package.json`).

**Steps:**

1. In the project root, create `.env` if it doesn’t exist:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and set your key from [platform.openai.com](https://platform.openai.com/api-keys):
   ```env
   OPENAI_API_KEY=sk-your-actual-key-here
   ```
3. Save the file. The server loads `.env` automatically when you run it.  
   **Do not commit `.env`** (it’s in `.gitignore`).

---

## 2. Database

You need PostgreSQL and a connection URL.

**Option A – Local PostgreSQL (e.g. Homebrew)**

```bash
brew services start postgresql@18   # or your version
createdb debate_vault
export DATABASE_URL="postgresql://$(whoami)@localhost:5432/debate_vault"
```

**Option B – Hosted (Neon, Supabase, etc.)**

Create a database and set:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Put `DATABASE_URL` in `.env` as well so you don’t have to export it every time.

---

## 3. One-time setup

From the project root:

```bash
npm install
npm run db:push
npm run seed
```

- `db:push` creates/updates tables.
- `seed` loads all `.docx` files from **`preload-files/`** into the app (and runs AI indexing if `OPENAI_API_KEY` is set).

---

## 4. Run the app

```bash
npm run dev
```

Then open: **http://127.0.0.1:5000**

If the browser says “invalid response”, the server may have crashed (e.g. missing `DATABASE_URL` or bad OpenAI key). Check the terminal for errors.

---

## 5. Preload / tinker files

- **`preload-files/`** is the single folder used for seeding.
- To change what’s in the app: add or replace `.docx` files in **`preload-files/`**, then run:
  ```bash
  npm run seed
  ```
  New files are added; existing ones (by `originalFilename`) are skipped. With `OPENAI_API_KEY` set, new docs get AI keywords and tags.

### Keeping original names from test-files

If you keep your evidence in **`test-files/`** (e.g. in folders like `AFF copy/`, `NEG copy/`), run:

```bash
npm run preload:sync
npm run seed
```

- **`preload:sync`** copies every `.docx` from `test-files/` into `preload-files/` and names them by **path**, e.g. `AFF copy - February 2026---Civil War AFF---Manan.docx`. Temp files (`~$...`) are skipped. That way the app shows the original folder + filename instead of generic or duplicate names.
- **`seed`** then loads those names into the app as the document **display name** (`originalFilename`). On disk, files in `uploads/` still use unique internal names to avoid collisions; only the name you see in the Library/Search is the original-style name.

---

## Quick reference

| Task              | Command / location                          |
|-------------------|---------------------------------------------|
| API key           | `.env` in project root: `OPENAI_API_KEY=sk-...` |
| DB URL            | `.env`: `DATABASE_URL=postgresql://...`      |
| Create/update DB  | `npm run db:push`                            |
| Load preload docs | `npm run seed`                              |
| Start app         | `npm run dev` → http://127.0.0.1:5000        |
| Tinker files      | Add/edit `.docx` in `preload-files/`, then `npm run seed` |
| Original names from test-files | `npm run preload:sync` then `npm run seed` |
