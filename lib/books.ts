import fs from "fs";
import path from "path";

export type BookStatus = "ongoing" | "complete" | "new";

export interface Book {
  id: string;
  title: string;
  subtitle: string;
  status: BookStatus;
  keywords: string[];
  poems: string[]; // slugs in sequence
}

export interface BookPosition {
  book: Book;
  position: number; // 1-indexed
}

const BOOKS_FILE = path.join(process.cwd(), "content", "books", "index.json");

export function getAllBooks(): Book[] {
  const raw = fs.readFileSync(BOOKS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function getBookById(id: string): Book | null {
  return getAllBooks().find((b) => b.id === id) ?? null;
}

// Returns which book a slug belongs to, and its position
export function getBookForPoem(slug: string): BookPosition | null {
  for (const book of getAllBooks()) {
    const idx = book.poems.indexOf(slug);
    if (idx !== -1) return { book, position: idx + 1 };
  }
  return null;
}

// Returns all books a slug appears in (a poem can only be in one)
export function getBooksContaining(slug: string): BookPosition[] {
  const results: BookPosition[] = [];
  for (const book of getAllBooks()) {
    const idx = book.poems.indexOf(slug);
    if (idx !== -1) results.push({ book, position: idx + 1 });
  }
  return results;
}

export function getPrevNextInBook(book: Book, slug: string): {
  prev: string | null;
  next: string | null;
} {
  const idx = book.poems.indexOf(slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? book.poems[idx - 1] : null,
    next: idx < book.poems.length - 1 ? book.poems[idx + 1] : null,
  };
}
