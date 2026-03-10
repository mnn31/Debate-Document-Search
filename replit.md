# PF Vault - Debate Evidence Manager

## Overview
AI-powered evidence management tool for Public Forum Debate. Upload .docx evidence files, get auto-tags and AI keyword indexing for instant semantic search. Opponent case analyzer breaks down argument structure (UQ → L → IL → !) and finds typed responses (NUQ, NL, L/T, N!, !/T) from your evidence library.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + wouter routing + TanStack Query
- **Backend**: Express.js + PostgreSQL (Drizzle ORM)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-nano for speed-optimized search)
- **File Parsing**: mammoth.js for .docx to HTML/text extraction
- **File Upload**: multer for multipart form handling

## Debate Terminology (DEBATE_TERMINOLOGY constant in routes.ts)
- UQ/U = Uniqueness (status quo), L = Link, IL = Internal Link, ! = Impact
- NUQ = Nonunique, NL = No Link, L/T = Link Turn, N! = No Impact, !/T = Impact Turn
- Common abbreviations: heg=hegemony, cap=capitalism, dedev=degrowth, prolif=proliferation, nuke war=nuclear war, SCS=South China Sea, china rise=china heg
- All AI prompts include this terminology for consistent debate-aware responses

## Search Architecture (Multi-Layer)
1. **Upload-time AI indexing**: AI generates 30 debate-specific keywords + 5-8 auto-tags (including abbreviations, synonyms, argument types, impact chains)
2. **Instant keyword search** (`POST /api/search`): Multi-layer PostgreSQL search with weighted ranking — filename gets quadratic multi-term match bonus, full-phrase matching in tags/keywords gets extra boost
3. **AI semantic search** (`POST /api/search/semantic`): AI analyzes query against library metadata, understands debate synonyms (china heg = china rise)
4. **AI summaries** (`POST /api/search/ai-enhance`): After results shown, AI generates per-result contextual summaries
5. Frontend runs keyword + semantic in parallel, shows results immediately, loads summaries async

## Key Features
1. **Upload .docx files** — auto-tagged by AI, no manual tagging needed
2. **AI-powered semantic search** — finds evidence by concept, not just keywords
3. **Section-level indexing** — parses headings for granular search
4. **Original file download** — preserves all formatting
5. **Opponent case analyzer** — breaks down opponent's case into UQ/L/IL/! structure, finds NUQ/NL/L/T/N!/!/T responses from your library
6. **AI keyword indexing** — 30 keywords per doc at upload time for instant search
7. **Auto-tagging** — AI generates 5-8 categorization tags automatically on upload
8. **Re-index** — manual re-index button regenerates keywords AND auto-tags
9. **Evidence card detection** — parses individual cards with TAG/CITE/BODY structure; detects analytics (subheaders without evidence body)
10. **Card viewer** — `/documents/:id` shows all parsed cards per document
11. **Recut signature editor** — add "recut [name]" to end of card citations for attribution
12. **Card search** — search within individual evidence cards, toggle between document and card search modes
13. **AT/A2 synonym expansion** — "AT tradeoff" auto-expands to "answer to tradeoff" at search time

## Database Schema
- `users` - basic user table (unused currently)
- `documents` - uploaded files with tags, extracted text, AI keywords, search index
- `document_sections` - parsed sections (by headings) for granular search
- `evidence_cards` - individual parsed cards with tag/cite/body, isAnalytic flag, customTag/customCite for user edits, sectionHeading for section context

## Important: AI Token Limits
- gpt-5-nano uses ~88% of completion tokens for internal reasoning
- Always set `max_completion_tokens` to at least 4096 for keyword generation
- Do NOT use `response_format: { type: "json_object" }` — causes empty responses
- Strip markdown fences before JSON parsing; use `parseAiJson()` helper with regex fallback

## File Structure
- `shared/schema.ts` - Drizzle schema definitions
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations with search ranking (quadratic filename boost)
- `server/routes.ts` - API endpoints, DEBATE_TERMINOLOGY constant, AI prompts
- `client/src/pages/` - Search, Library, Upload, Opponent, Document (card viewer) pages
- `client/src/components/app-sidebar.tsx` - Navigation sidebar
- `uploads/` - Stored .docx files (filesystem)

## API Endpoints
- `POST /api/documents/upload` - Upload .docx, triggers async AI indexing + auto-tagging
- `GET /api/documents` - List all documents (lightweight, includes indexing status)
- `GET /api/documents/:id` - Get document with sections
- `GET /api/documents/:id/download` - Download original .docx
- `PATCH /api/documents/:id/tags` - Update document tags
- `DELETE /api/documents/:id` - Delete document
- `POST /api/search` - Instant keyword/tag search (no AI call)
- `POST /api/search/semantic` - AI semantic search
- `POST /api/search/ai-enhance` - Generate AI summaries for results
- `POST /api/documents/:id/reindex` - Regenerate AI keywords AND auto-tags
- `POST /api/analyze-opponent-case` - Break down opponent case, find typed responses
- `GET /api/documents/:id/cards` - Get all evidence cards for a document
- `POST /api/documents/:id/reparse-cards` - Re-parse evidence cards from document HTML
- `PATCH /api/cards/:id/signature` - Update card customTag/customCite (recut signature)
- `POST /api/search/cards` - Search within individual evidence cards
- `POST /api/documents/reparse-all-cards` - Re-parse cards for ALL documents at once
- `GET /api/documents/:id/download-section?heading=...` - Download a specific section as .docx with formatting preserved

## Search Architecture Details
- Section heading matches (all query terms in one heading) get +800 rank bonus
- Card tag match count per document gets scaled bonus (up to 10 matches × 60)
- Section heading match count per document gets scaled bonus (up to 10 matches × 80)
- Section headings are normalized (colons, dashes stripped) for matching "AT tradeoff" → "AT: FTC Tradeoff"
- Evidence card parser: h1-h2 = section dividers (skipped), h3 = section divider unless followed by cite, h4+ = card tags; `<p>` with bold/underline also treated as tags
- Card search uses stored `sectionHeading` on each card (not document-level lookup) with +500 rank bonus; cards belong to their section and are prioritized when section name matches query
- jszip used for section download: extracts paragraphs from original .docx XML between heading boundaries

## Environment
- Uses Replit AI Integrations for OpenAI (no API key needed)
- PostgreSQL database via DATABASE_URL
- File uploads stored in `uploads/` directory
