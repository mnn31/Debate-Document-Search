import { eq, sql, ilike, or, arrayContains } from "drizzle-orm";
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

  createSections(sections: InsertDocumentSection[]): Promise<DocumentSection[]>;
  getSectionsByDocumentId(documentId: number): Promise<DocumentSection[]>;
  deleteSectionsByDocumentId(documentId: number): Promise<void>;

  searchDocuments(query: string): Promise<Array<Document & { matchingSections: DocumentSection[] }>>;
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

  async deleteSectionsByDocumentId(documentId: number): Promise<void> {
    await db.delete(documentSections).where(eq(documentSections.documentId, documentId));
  }

  async searchDocuments(query: string): Promise<Array<Document & { matchingSections: DocumentSection[] }>> {
    const lowerQuery = `%${query.toLowerCase()}%`;

    const matchedDocs = await db
      .select()
      .from(documents)
      .where(
        or(
          ilike(documents.textContent, lowerQuery),
          ilike(documents.originalFilename, lowerQuery),
          sql`EXISTS (SELECT 1 FROM unnest(${documents.tags}) AS tag WHERE LOWER(tag) LIKE ${lowerQuery})`
        )
      );

    const results: Array<Document & { matchingSections: DocumentSection[] }> = [];

    for (const doc of matchedDocs) {
      const sections = await db
        .select()
        .from(documentSections)
        .where(eq(documentSections.documentId, doc.id))
        .orderBy(documentSections.sectionIndex);

      const matchingSections = sections.filter(
        (s) =>
          s.heading.toLowerCase().includes(query.toLowerCase()) ||
          s.content.toLowerCase().includes(query.toLowerCase())
      );

      results.push({
        ...doc,
        matchingSections: matchingSections.length > 0 ? matchingSections : sections.slice(0, 1),
      });
    }

    return results;
  }
}

export const storage = new DatabaseStorage();
