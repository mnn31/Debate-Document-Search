import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  textContent: text("text_content").notNull().default(""),
  uploadedAt: timestamp("uploaded_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true,
});

export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export const documentSections = pgTable("document_sections", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  heading: text("heading").notNull().default(""),
  content: text("content").notNull(),
  sectionIndex: integer("section_index").notNull().default(0),
}, (table) => [
  index("idx_sections_document_id").on(table.documentId),
]);

export const insertDocumentSectionSchema = createInsertSchema(documentSections).omit({
  id: true,
});

export type InsertDocumentSection = z.infer<typeof insertDocumentSectionSchema>;
export type DocumentSection = typeof documentSections.$inferSelect;
