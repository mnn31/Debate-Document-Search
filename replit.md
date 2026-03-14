# How to run PF Vault on Replit

Follow these steps to run the app on [Replit](https://replit.com).

---

## 1. Open the project

Open your PF Vault Repl (or fork/clone it into a new Repl).

---

## 2. Set Secrets (environment variables)

Replit uses **Secrets** instead of a `.env` file. Do **not** put API keys in code or in a committed `.env` file.

1. Click the **padlock (Secrets)** icon in the left sidebar (or Tools → Secrets).
2. Add these keys:

| Secret name         | Value | Required |
|---------------------|-------|----------|
| `DATABASE_URL`      | Your PostgreSQL connection string (see below). | Yes |
| `OPENAI_API_KEY`    | Your OpenAI API key (`sk-...` from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)). | No (app works without it; needed for AI features) |

**Getting a database on Replit**

- **Replit Postgres:** In the Repl, use the **Database** (Postgres) tool. Replit will create a DB and give you a connection URL. Copy it and add it as the `DATABASE_URL` Secret.  
  See [Replit Docs: PostgreSQL](https://docs.replit.com/cloud-services/storage-and-databases/postgresql-on-replit).
- **External (Neon, Supabase, etc.):** Create a PostgreSQL database, copy its connection URL, and paste it as the `DATABASE_URL` Secret.

---

## 3. Install and set up the database

In the Replit **Shell** (or Console), run:

```bash
npm install
npm run db:push
```

- `db:push` creates or updates the tables in the database.

---

## 4. (Optional) Load preload files and verify OpenAI

If you have a `preload-files/` folder with `.docx` files:

```bash
npm run seed
```

If you set `OPENAI_API_KEY` and want to confirm it works:

```bash
npm run verify:openai
```

You should see: `OpenAI API key is valid. Model: gpt-4o-mini`.

---

## 5. Run the app

In the Shell:

```bash
npm run dev
```

Replit will assign a **PORT** automatically; the app uses `process.env.PORT` or defaults to `5000`. Replit usually opens a **Webview** or shows a “Open website” link. Use that URL to open PF Vault in the browser.

If the app doesn’t open:

- Check the Shell for the printed URL (e.g. `http://0.0.0.0:5000`).
- Use Replit’s “Open website” / “Webview” so Replit routes the correct port.

---

## 6. Optional: copy test-files into uploads

If you have a `test-files/` folder and want every file in one folder (`uploads/`) with original naming:

```bash
npm run copy:test-to-uploads
```

To refresh what’s in the app from `test-files/` (path-based names):

```bash
npm run preload:sync
npm run seed
```

---

## Quick reference (Replit)

| Step              | Command / action |
|-------------------|-------------------|
| Set API key & DB   | Secrets: `OPENAI_API_KEY`, `DATABASE_URL` |
| Install            | `npm install` |
| Create/update DB    | `npm run db:push` |
| Load preload docs  | `npm run seed` |
| Verify OpenAI      | `npm run verify:openai` |
| Run app            | `npm run dev` → open Replit Webview / URL |

---

## Troubleshooting

- **“DATABASE_URL is required”** — Add `DATABASE_URL` in Secrets with a valid PostgreSQL connection string.
- **“OpenAI API error” / 401** — Add or fix `OPENAI_API_KEY` in Secrets; run `npm run verify:openai` to test.
- **Blank or “invalid response” in browser** — Check the Shell for errors (e.g. missing DB or crashed server). Ensure you’re opening the URL Replit shows for the app (correct port).
- **Replit uses a different port** — The app reads `PORT` from the environment; Replit sets this automatically. You don’t need to change it.
