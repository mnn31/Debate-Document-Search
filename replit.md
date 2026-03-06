# PF Vault - Debate Evidence Manager

## Overview
AI-powered evidence management tool for Public Forum Debate. Upload .docx evidence files, tag them, and search semantically using AI. Also analyze opponent cases to find responsive evidence.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + wouter routing + TanStack Query
- **Backend**: Express.js + PostgreSQL (Drizzle ORM)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-nano for speed-optimized search)
- **File Parsing**: mammoth.js for .docx to HTML/text extraction
- **File Upload**: multer for multipart form handling

## Key Features
1. **Upload .docx files** with tags for categorization
2. **AI-powered semantic search** - finds evidence by concept, not just keywords
3. **Section-level indexing** - parses headings to enable granular search
4. **Original file download** - preserves all formatting (highlighting, bold, underline, font sizes)
5. **Opponent case analyzer** - upload opponent's case, AI finds your responses

## Database Schema
- `users` - basic user table (unused currently)
- `documents` - uploaded files with tags and extracted text
- `document_sections` - parsed sections (by headings) for granular search

## File Structure
- `shared/schema.ts` - Drizzle schema definitions
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations (IStorage interface)
- `server/routes.ts` - API endpoints (upload, search, download, analyze)
- `client/src/pages/` - Search, Library, Upload, Opponent pages
- `client/src/components/app-sidebar.tsx` - Navigation sidebar
- `uploads/` - Stored .docx files (filesystem)

## API Endpoints
- `POST /api/documents/upload` - Upload .docx with tags
- `GET /api/documents` - List all documents
- `GET /api/documents/:id` - Get document with sections
- `GET /api/documents/:id/download` - Download original .docx
- `PATCH /api/documents/:id/tags` - Update document tags
- `DELETE /api/documents/:id` - Delete document
- `POST /api/search` - AI-powered semantic search
- `POST /api/analyze-opponent-case` - Analyze opponent's case

## Environment
- Uses Replit AI Integrations for OpenAI (no API key needed)
- PostgreSQL database via DATABASE_URL
- File uploads stored in `uploads/` directory
