import { eq, sql, or } from "drizzle-orm";
import { db } from "./db";
import {
  documents, documentSections, evidenceCards,
  type Document, type InsertDocument,
  type DocumentSection, type InsertDocumentSection,
  type EvidenceCard, type InsertEvidenceCard,
  type User, type InsertUser, users,
} from "@shared/schema";
import { randomUUID } from "crypto";

const DEBATE_SYNONYMS: Record<string, string[]> = {
  "at": ["answer to", "a2", "answers to", "at:"],
  "a2": ["answer to", "at", "answers to", "a2:"],
  "heg": ["hegemony", "china rise", "us primacy", "unipolarity"],
  "dedev": ["degrowth", "growth bad", "economic decline good"],
  "cap": ["capitalism"],
  "nuke": ["nuclear"],
  "prolif": ["proliferation"],
  "uq": ["uniqueness", "status quo"],
  "il": ["internal link"],
  "da": ["disadvantage"],
  "cp": ["counterplan"],
  "k": ["kritik", "critique"],
  "tradeoff": ["trade off", "trade-off"],
  "ftc": ["federal trade commission", "ftc tradeoff", "ftc trade-off"],
};

function expandSearchTerms(terms: string[]): string[] {
  const expanded = new Set(terms);
  const joined = terms.join(" ").toLowerCase();

  for (const [abbrev, synonyms] of Object.entries(DEBATE_SYNONYMS)) {
    if (terms.includes(abbrev) || joined.includes(abbrev)) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }

  return Array.from(expanded);
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  createDocument(doc: InsertDocument): Promise<Document>;
  getDocument(id: number): Promise<Document | undefined>;
  getAllDocuments(): Promise<Document[]>;
  deleteDocument(id: number): Promise<void>;
  updateDocumentTags(id: number, tags: string[]): Promise<Document | undefined>;
  updateDocumentAiData(id: number, aiKeywords: string[], searchIndex: string): Promise<void>;

  createSections(sections: InsertDocumentSection[]): Promise<DocumentSection[]>;
  getSectionsByDocumentId(documentId: number): Promise<DocumentSection[]>;

  createCards(cards: InsertEvidenceCard[]): Promise<EvidenceCard[]>;
  getCardsByDocumentId(documentId: number): Promise<EvidenceCard[]>;
  updateCardSignature(id: number, customTag: string | null, customCite: string | null): Promise<EvidenceCard | undefined>;
  updateCardSignaturePartial(id: number, updates: Partial<{ customTag: string | null; customCite: string | null }>): Promise<EvidenceCard | undefined>;
  deleteCardsByDocumentId(documentId: number): Promise<void>;
  searchCards(query: string): Promise<Array<{ card: EvidenceCard; doc: Document; rank: number; sectionHeading: string | null }>>;

  fullTextSearch(query: string): Promise<Array<{ doc: Document; rank: number }>>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ ...insertUser, id }).returning();
    return user;
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const [document] = await db.insert(documents).values(doc).returning();
    return document;
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document;
  }

  async getAllDocuments(): Promise<Document[]> {
    return db.select().from(documents).orderBy(sql`${documents.uploadedAt} DESC`);
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(evidenceCards).where(eq(evidenceCards.documentId, id));
    await db.delete(documentSections).where(eq(documentSections.documentId, id));
    await db.delete(documents).where(eq(documents.id, id));
  }

  async updateDocumentTags(id: number, tags: string[]): Promise<Document | undefined> {
    const [updated] = await db
      .update(documents)
      .set({ tags })
      .where(eq(documents.id, id))
      .returning();
    return updated;
  }

  async updateDocumentAiData(id: number, aiKeywords: string[], searchIndex: string): Promise<void> {
    await db
      .update(documents)
      .set({ aiKeywords, searchIndex })
      .where(eq(documents.id, id));
  }

  async createSections(sections: InsertDocumentSection[]): Promise<DocumentSection[]> {
    if (sections.length === 0) return [];
    return db.insert(documentSections).values(sections).returning();
  }

  async getSectionsByDocumentId(documentId: number): Promise<DocumentSection[]> {
    return db
      .select()
      .from(documentSections)
      .where(eq(documentSections.documentId, documentId))
      .orderBy(documentSections.sectionIndex);
  }

  async createCards(cards: InsertEvidenceCard[]): Promise<EvidenceCard[]> {
    if (cards.length === 0) return [];
    return db.insert(evidenceCards).values(cards).returning();
  }

  async getCardsByDocumentId(documentId: number): Promise<EvidenceCard[]> {
    return db
      .select()
      .from(evidenceCards)
      .where(eq(evidenceCards.documentId, documentId))
      .orderBy(evidenceCards.cardIndex);
  }

  async updateCardSignature(id: number, customTag: string | null, customCite: string | null): Promise<EvidenceCard | undefined> {
    const [updated] = await db
      .update(evidenceCards)
      .set({ customTag, customCite })
      .where(eq(evidenceCards.id, id))
      .returning();
    return updated;
  }

  async updateCardSignaturePartial(id: number, updates: Partial<{ customTag: string | null; customCite: string | null }>): Promise<EvidenceCard | undefined> {
    if (Object.keys(updates).length === 0) {
      const [card] = await db.select().from(evidenceCards).where(eq(evidenceCards.id, id));
      return card;
    }
    const [updated] = await db
      .update(evidenceCards)
      .set(updates)
      .where(eq(evidenceCards.id, id))
      .returning();
    return updated;
  }

  async deleteCardsByDocumentId(documentId: number): Promise<void> {
    await db.delete(evidenceCards).where(eq(evidenceCards.documentId, documentId));
  }

  async searchCards(query: string): Promise<Array<{ card: EvidenceCard; doc: Document; rank: number; sectionHeading: string | null }>> {
    const rawTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (rawTerms.length === 0) return [];

    const searchTerms = expandSearchTerms(rawTerms);
    const likePatterns = searchTerms.map((term) => `%${term}%`);

    const normalizedTerms = rawTerms.map((t) => t.replace(/[:\-_\/–—.]/g, "")).filter((t) => t.length > 0);
    const normalizedQuery = normalizedTerms.join(" ");
    const normalizedPattern = `%${normalizedQuery}%`;

    const headingNormSql = sql`LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ds.heading, ':', ' '), '-', ' '), '–', ' '), '—', ' '), '/', ' '), '_', ' '))`;

    const conditions = likePatterns.flatMap((pattern) => [
      sql`LOWER(${evidenceCards.tag}) LIKE ${pattern}`,
      sql`LOWER(${evidenceCards.cite}) LIKE ${pattern}`,
      sql`LOWER(${evidenceCards.body}) LIKE ${pattern}`,
    ]);

    const normalizedHeadingConditions = normalizedTerms.map((term) => {
      const p = `%${term}%`;
      return sql`EXISTS (SELECT 1 FROM document_sections ds WHERE ds.document_id = ${evidenceCards.documentId} AND ${headingNormSql} LIKE ${p})`;
    });

    const fullQuery = query.toLowerCase();
    const fullQueryPattern = `%${fullQuery}%`;

    const sectionHeadingExpr = sql<string | null>`(SELECT ds.heading FROM document_sections ds WHERE ds.document_id = ${evidenceCards.documentId} AND (${
      normalizedTerms.map((term) => {
        const p = `%${term}%`;
        return sql`${headingNormSql} LIKE ${p}`;
      }).reduce((acc, curr) => sql`${acc} AND ${curr}`)
    }) ORDER BY LENGTH(ds.heading) LIMIT 1)`;

    const rankExpr = sql<number>`(
      ${searchTerms.map((term) => {
        const p = `%${term}%`;
        return sql`(
          CASE WHEN LOWER(${evidenceCards.tag}) LIKE ${p} THEN 60 ELSE 0 END +
          CASE WHEN LOWER(${evidenceCards.cite}) LIKE ${p} THEN 20 ELSE 0 END +
          CASE WHEN LOWER(${evidenceCards.body}) LIKE ${p} THEN 10 ELSE 0 END
        )`;
      }).reduce((acc, curr) => sql`${acc} + ${curr}`)}
      + CASE WHEN LOWER(${evidenceCards.tag}) LIKE ${fullQueryPattern} THEN 200 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM document_sections ds WHERE ds.document_id = ${evidenceCards.documentId} AND ${
        normalizedTerms.map((term) => {
          const p = `%${term}%`;
          return sql`${headingNormSql} LIKE ${p}`;
        }).reduce((acc, curr) => sql`${acc} AND ${curr}`)
      }) THEN 300 ELSE 0 END
    )`;

    const results = await db
      .select({
        card: evidenceCards,
        doc: documents,
        rank: rankExpr,
        sectionHeading: sectionHeadingExpr,
      })
      .from(evidenceCards)
      .innerJoin(documents, eq(evidenceCards.documentId, documents.id))
      .where(or(...conditions, ...normalizedHeadingConditions))
      .orderBy(sql`${rankExpr} DESC`)
      .limit(30);

    return results.filter((r) => r.rank > 0);
  }

  async fullTextSearch(query: string): Promise<Array<{ doc: Document; rank: number }>> {
    const rawTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (rawTerms.length === 0) return [];

    const searchTerms = expandSearchTerms(rawTerms);
    const likePatterns = searchTerms.map((term) => `%${term}%`);

    const normalizedQuery = query.toLowerCase().replace(/[:\-_\/]/g, " ").replace(/\s+/g, " ").trim();
    const normalizedPattern = `%${normalizedQuery}%`;

    const conditions = likePatterns.flatMap((pattern) => [
      sql`LOWER(${documents.originalFilename}) LIKE ${pattern}`,
      sql`LOWER(${documents.searchIndex}) LIKE ${pattern}`,
      sql`LOWER(${documents.textContent}) LIKE ${pattern}`,
      sql`EXISTS (SELECT 1 FROM unnest(${documents.tags}) AS tag WHERE LOWER(tag) LIKE ${pattern})`,
      sql`EXISTS (SELECT 1 FROM unnest(${documents.aiKeywords}) AS kw WHERE LOWER(kw) LIKE ${pattern})`,
      sql`EXISTS (SELECT 1 FROM document_sections ds WHERE ds.document_id = ${documents.id} AND LOWER(ds.heading) LIKE ${pattern})`,
      sql`EXISTS (SELECT 1 FROM evidence_cards ec WHERE ec.document_id = ${documents.id} AND LOWER(ec.tag) LIKE ${pattern})`,
    ]);

    const headingNormSqlDoc = sql`LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ds.heading, ':', ' '), '-', ' '), '–', ' '), '—', ' '), '/', ' '), '_', ' '))`;
    const tagNormSqlDoc = sql`LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ec.tag, ':', ' '), '-', ' '), '–', ' '), '—', ' '), '/', ' '), '_', ' '))`;
    const normalizedConditions = [
      sql`EXISTS (SELECT 1 FROM document_sections ds WHERE ds.document_id = ${documents.id} AND ${headingNormSqlDoc} LIKE ${normalizedPattern})`,
      sql`EXISTS (SELECT 1 FROM evidence_cards ec WHERE ec.document_id = ${documents.id} AND ${tagNormSqlDoc} LIKE ${normalizedPattern})`,
    ];

    const fullQuery = query.toLowerCase().replace(/[_-]/g, " ");
    const fullQueryPattern = `%${fullQuery}%`;

    const filenameMatchCount = searchTerms.map((term) => {
      const p = `%${term}%`;
      return sql`CASE WHEN LOWER(REPLACE(REPLACE(${documents.originalFilename}, '_', ' '), '-', ' ')) LIKE ${p} THEN 1 ELSE 0 END`;
    }).reduce((acc, curr) => sql`${acc} + ${curr}`);

    const sectionHeadingMatchCount = searchTerms.map((term) => {
      const p = `%${term}%`;
      return sql`(SELECT COUNT(*)::int FROM document_sections ds WHERE ds.document_id = ${documents.id} AND LOWER(ds.heading) LIKE ${p})`;
    }).reduce((acc, curr) => sql`${acc} + ${curr}`);

    const cardTagMatchCount = searchTerms.map((term) => {
      const p = `%${term}%`;
      return sql`(SELECT COUNT(*)::int FROM evidence_cards ec WHERE ec.document_id = ${documents.id} AND LOWER(ec.tag) LIKE ${p})`;
    }).reduce((acc, curr) => sql`${acc} + ${curr}`);

    const rankExpr = sql<number>`(
      ${searchTerms.map((term) => {
        const p = `%${term}%`;
        return sql`(
          CASE WHEN LOWER(${documents.originalFilename}) LIKE ${p} THEN 50 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM unnest(${documents.tags}) AS tag WHERE LOWER(tag) LIKE ${p}) THEN 40 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM unnest(${documents.aiKeywords}) AS kw WHERE LOWER(kw) LIKE ${p}) THEN 30 ELSE 0 END +
          CASE WHEN LOWER(${documents.searchIndex}) LIKE ${p} THEN 20 ELSE 0 END +
          CASE WHEN LOWER(${documents.textContent}) LIKE ${p} THEN 10 ELSE 0 END
        )`;
      }).reduce((acc, curr) => sql`${acc} + ${curr}`)}
      + (${filenameMatchCount}) * (${filenameMatchCount}) * 50
      + LEAST(${sectionHeadingMatchCount}, 10) * 80
      + LEAST(${cardTagMatchCount}, 10) * 60
      + CASE WHEN LOWER(REPLACE(REPLACE(${documents.originalFilename}, '_', ' '), '-', ' ')) LIKE ${fullQueryPattern} THEN 300 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM unnest(${documents.tags}) AS tag WHERE LOWER(tag) LIKE ${fullQueryPattern}) THEN 200 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM unnest(${documents.aiKeywords}) AS kw WHERE LOWER(kw) LIKE ${fullQueryPattern}) THEN 150 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM document_sections ds WHERE ds.document_id = ${documents.id} AND ${
        rawTerms.map((term) => {
          const p = `%${term.replace(/[:\-_\/–—.]/g, "")}%`;
          return sql`${headingNormSqlDoc} LIKE ${p}`;
        }).reduce((acc, curr) => sql`${acc} AND ${curr}`)
      }) THEN 800 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM evidence_cards ec WHERE ec.document_id = ${documents.id} AND LOWER(ec.tag) LIKE ${fullQueryPattern}) THEN 250 ELSE 0 END
    )`;

    const results = await db
      .select({
        doc: documents,
        rank: rankExpr,
      })
      .from(documents)
      .where(or(...conditions, ...normalizedConditions))
      .orderBy(sql`${rankExpr} DESC`)
      .limit(20);

    return results.filter((r) => r.rank > 0);
  }
}

export const storage = new DatabaseStorage();
