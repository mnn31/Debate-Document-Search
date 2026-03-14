# How to run PF Vault

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

- **`preload-files/`** is the single folder used for seeding. It already contains copies of everything from `test-files/` and `uploads/` (all `.docx`).
- To change what’s in the app: add or replace `.docx` files in **`preload-files/`**, then run:
  ```bash
  npm run seed
  ```
  New files are added; existing ones (by name) are skipped. With `OPENAI_API_KEY` set, new docs get AI keywords and tags.

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
