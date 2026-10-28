/**
 * One-time: store Open Library cover URLs and ISBNs on sampleLibrary.
 * Run from the repo root: npx tsx scripts/fill-sample-covers.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  coverFieldsFromOpenLibraryDoc,
  sampleLibrary,
  type OpenLibrarySearchDoc,
  type SampleBook,
} from "../src/lib/sampleLibrary";

const START = "// SAMPLE_LIBRARY_START";
const END = "// SAMPLE_LIBRARY_END";
const catalogPath = path.join(process.cwd(), "src", "lib", "sampleLibrary.ts");

function quote(value: string): string {
  return JSON.stringify(value);
}

async function lookup(
  title: string,
  author: string,
): Promise<{ image?: string; isbn?: string }> {
  const url =
    "https://openlibrary.org/search.json" +
    `?title=${encodeURIComponent(title)}` +
    `&author=${encodeURIComponent(author)}` +
    "&limit=1";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "audio-book-gen/sample-library (local catalog fill)",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as { docs?: OpenLibrarySearchDoc[] };
  return coverFieldsFromOpenLibraryDoc(body.docs?.[0]);
}

function recordLine(book: SampleBook): string {
  const parts = [`title: ${quote(book.title)}`, `author: ${quote(book.author)}`];
  if (book.isbn?.trim()) parts.push(`isbn: ${quote(book.isbn)}`);
  if (book.image) parts.push(`image: ${quote(book.image)}`);
  if (book.link?.trim()) parts.push(`link: ${quote(book.link)}`);
  return `  { ${parts.join(", ")} },`;
}

async function main() {
  const filled: SampleBook[] = [];
  for (const book of sampleLibrary) {
    try {
      const fields = await lookup(book.title, book.author);
      const next: SampleBook = {
        title: book.title,
        author: book.author,
        ...fields,
      };
      if (book.link?.trim()) next.link = book.link;
      filled.push(next);
      console.log(
        `${book.title}: ${fields.image ? "cover" : "no cover"}`,
      );
    } catch (error) {
      const next: SampleBook = { title: book.title, author: book.author };
      if (book.link?.trim()) next.link = book.link;
      filled.push(next);
      const message = error instanceof Error ? error.message : "error";
      console.log(`${book.title}: failed (${message})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const source = readFileSync(catalogPath, "utf8");
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("SAMPLE_LIBRARY markers missing");
  }
  const block = `${START}\n${filled.map(recordLine).join("\n")}\n  ${END}`;
  const next = source.slice(0, start) + block + source.slice(end + END.length);
  writeFileSync(catalogPath, next);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
