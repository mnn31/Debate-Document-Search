import { eq, sql, or } from "drizzle-orm";
import { db } from "./db";
import {
  documents, documentSections,
  type Document, type InsertDocument,
  type DocumentSection, type InsertDocumentSection,
  type User, type InsertUser, users,
} from "@shared/schema";
import { randomUUID } from "crypto";

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

  async fullTextSearch(query: string): Promise<Array<{ doc: Document; rank: number }>> {
    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (searchTerms.length === 0) return [];

    const likePatterns = searchTerms.map((term) => `%${term}%`);

    const conditions = likePatterns.flatMap((pattern) => [
      sql`LOWER(${documents.originalFilename}) LIKE ${pattern}`,
      sql`LOWER(${documents.searchIndex}) LIKE ${pattern}`,
      sql`LOWER(${documents.textContent}) LIKE ${pattern}`,
      sql`EXISTS (SELECT 1 FROM unnest(${documents.tags}) AS tag WHERE LOWER(tag) LIKE ${pattern})`,
      sql`EXISTS (SELECT 1 FROM unnest(${documents.aiKeywords}) AS kw WHERE LOWER(kw) LIKE ${pattern})`,
    ]);

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
    )`;

    const results = await db
      .select({
        doc: documents,
        rank: rankExpr,
      })
      .from(documents)
      .where(or(...conditions))
      .orderBy(sql`${rankExpr} DESC`)
      .limit(20);

    return results.filter((r) => r.rank > 0);
  }
}

export const storage = new DatabaseStorage();
