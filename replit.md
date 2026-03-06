# PF Vault - Debate Evidence Manager

## Overview
AI-powered evidence management tool for Public Forum Debate. Upload .docx evidence files, tag them, and search semantically using AI. Also analyze opponent cases to find responsive evidence.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + wouter routing + TanStack Query
- **Backend**: Express.js + PostgreSQL (Drizzle ORM)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-nano for speed-optimized search)
- **File Parsing**: mammoth.js for .docx to HTML/text extraction
- **File Upload**: multer for multipart form handling

## Search Architecture (Multi-Layer)
1. **Upload-time AI indexing**: When files are uploaded, AI generates 25 debate-specific keywords (abbreviations, synonyms, argument types, impact chains) stored in `aiKeywords` column
2. **Instant keyword search** (`POST /api/search`): Multi-layer PostgreSQL search across filename, tags, AI keywords, search index, and full text with weighted ranking — NO AI call at search time
3. **AI semantic search** (`POST /api/search/semantic`): AI analyzes query against library metadata and finds conceptually related docs
4. **AI summaries** (`POST /api/search/ai-enhance`): After results shown, AI generates per-result contextual summaries
5. Frontend runs keyword + semantic in parallel, shows results immediately, loads summaries async

## Key Features
1. **Upload .docx files** with tags for categorization
2. **AI-powered semantic search** - finds evidence by concept, not just keywords
3. **Section-level indexing** - parses headings to enable granular search
4. **Original file download** - preserves all formatting (highlighting, bold, underline, font sizes)
5. **Opponent case analyzer** - upload opponent's case, AI finds your responses
6. **AI keyword indexing** - background AI indexing at upload time for instant search
7. **Re-index** - manual re-index button in library to regenerate AI keywords

## Database Schema
- `users` - basic user table (unused currently)
- `documents` - uploaded files with tags, extracted text, AI keywords, search index
- `document_sections` - parsed sections (by headings) for granular search

## Important: AI Token Limits
- gpt-5-nano uses ~88% of completion tokens for internal reasoning
- Always set `max_completion_tokens` to at least 4096 for keyword generation
- Do NOT use `response_format: { type: "json_object" }` — it causes empty responses with gpt-5-nano
- Strip markdown code fences from AI responses before JSON parsing

## File Structure
- `shared/schema.ts` - Drizzle schema definitions
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations (IStorage interface)
- `server/routes.ts` - API endpoints (upload, search, download, analyze)
- `client/src/pages/` - Search, Library, Upload, Opponent pages
- `client/src/components/app-sidebar.tsx` - Navigation sidebar
- `uploads/` - Stored .docx files (filesystem)

## API Endpoints
- `POST /api/documents/upload` - Upload .docx with tags (triggers async AI indexing)
- `GET /api/documents` - List all documents (lightweight, includes indexing status)
- `GET /api/documents/:id` - Get document with sections
- `GET /api/documents/:id/download` - Download original .docx
- `PATCH /api/documents/:id/tags` - Update document tags
- `DELETE /api/documents/:id` - Delete document
- `POST /api/search` - Instant keyword/tag search (no AI call)
- `POST /api/search/semantic` - AI semantic search
- `POST /api/search/ai-enhance` - Generate AI summaries for results
- `POST /api/documents/:id/reindex` - Regenerate AI keywords
- `POST /api/analyze-opponent-case` - Analyze opponent's case

## Environment
- Uses Replit AI Integrations for OpenAI (no API key needed)
- PostgreSQL database via DATABASE_URL
- File uploads stored in `uploads/` directory
