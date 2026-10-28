# Homepage Sample Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a static library of twenty sample books under the homepage upload form, with stored cover URLs and a Select control that stays disabled until a link is set.

**Architecture:** `src/lib/sampleLibrary.ts` holds the `SampleBook` array, the Select helper, and the Open Library field mapper. A one-time script writes `image` and `isbn` into that array. `SampleLibrary` renders the array under the existing upload form and does not fetch anything when the page loads.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind, Vitest, `tsx` for the one-time cover script, Open Library search and cover URLs.

## Global Constraints

- Catalog is `src/lib/sampleLibrary.ts`. It exports `SampleBook` and `sampleLibrary`.
- Records are the twenty books in the spec, in that order. `link` stays unset on every committed record.
- Cover search is `https://openlibrary.org/search.json?title={title}&author={author}&limit=1`. Use the title and author as written. Do not rewrite a title to improve the match.
- Use `docs[0]` only. `image` is `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg` when `cover_i` is present. `isbn` is `isbn[0]` when `isbn` is a non-empty array.
- An empty `docs` array, a missing `cover_i`, a missing `isbn`, or a failed request omits that field. Continue with the remaining books.
- The page does not fetch covers or book data. A later link edit does not repeat the search.
- The upload form stays `max-w-lg`. The library is `max-w-5xl`.
- Heading text is `Library`. The line under it is `Finished samples you can open and judge.`
- Grid is two columns by default, three from the `sm` breakpoint, four from the `lg` breakpoint.
- An empty `books` array renders nothing, including the heading.
- A non-empty `link` after trim shows Select and navigates to that `href` (app path or absolute URL). A missing, blank, or whitespace-only `link` shows a disabled Coming soon button and is not a link.
- Covers use a plain `img` with `alt` set to the title. Do not use `next/image`.
- A missing image, or an image `onError`, shows `coverGradientFromSeed(title)` and no broken-image icon.
- ISBN renders on its own line only when `isbn` is a non-empty string.
- Do not add a new button component. Select reuses the existing primary button classes.
- Vitest covers `sampleBookAction`. The grid is checked in the browser.
- Do not create jobs, generate audio, or change the job page.

## File map

| Path | Responsibility |
| --- | --- |
| `src/lib/sampleLibrary.ts` | `SampleBook`, the twenty-book array, `sampleBookAction`, `coverFieldsFromOpenLibraryDoc` |
| `tests/lib/sampleLibrary.test.ts` | Action helper, cover-field mapping, catalog shape |
| `scripts/fill-sample-covers.ts` | One-time Open Library lookup that rewrites the array between markers |
| `src/components/library/SampleLibrary.tsx` | Library section and book tiles |
| `src/app/page.tsx` | Renders `<SampleLibrary books={sampleLibrary} />` under the upload form |

---

### Task 1: Sample catalog and pure helpers

**Files:**
- Create: `src/lib/sampleLibrary.ts`
- Test: `tests/lib/sampleLibrary.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type SampleBook = { title: string; author: string; isbn?: string; image?: string; link?: string }`
  - `export type SampleBookAction = { label: "Select"; href: string } | { label: "Coming soon"; href: null }`
  - `export function sampleBookAction(book: SampleBook): SampleBookAction`
  - `export type OpenLibrarySearchDoc = { cover_i?: number; isbn?: string[] }`
  - `export function coverFieldsFromOpenLibraryDoc(doc: OpenLibrarySearchDoc | undefined): { image?: string; isbn?: string }`
  - `export const sampleLibrary: SampleBook[]` with the twenty title/author records between `// SAMPLE_LIBRARY_START` and `// SAMPLE_LIBRARY_END`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/sampleLibrary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  coverFieldsFromOpenLibraryDoc,
  sampleBookAction,
  sampleLibrary,
} from "@/lib/sampleLibrary";

const titles = [
  "Project Hail Mary",
  "The Wheel of Time (Series)",
  "The Hitchhiker's Guide to the Galaxy",
  "Good Omens",
  "Dune",
  "The Witch",
  "Verity",
  "The Silent Patient",
  "World War Z",
  "Tom Lake",
  "The Midnight Library",
  "The Dutch House",
  "Harry Potter and the Deathly Hallows",
  "The Odyssey",
  "The Woman in Me",
  "Born a Crime",
  "A Promised Land",
  "Atomic Habits",
  "Everything Is Tuberculosis",
  "Range",
];

describe("sampleLibrary", () => {
  it("lists the twenty starter books in order, with no links", () => {
    expect(sampleLibrary.map((book) => book.title)).toEqual(titles);
    expect(sampleLibrary.every((book) => book.author.trim().length > 0)).toBe(
      true,
    );
    expect(sampleLibrary.every((book) => book.link === undefined)).toBe(true);
  });
});

describe("sampleBookAction", () => {
  it("returns Select and the link href", () => {
    expect(
      sampleBookAction({
        title: "Dune",
        author: "Frank Herbert",
        link: "/jobs/13",
      }),
    ).toEqual({ label: "Select", href: "/jobs/13" });
  });

  it("returns Coming soon when the link is missing, blank, or whitespace", () => {
    const book = { title: "Dune", author: "Frank Herbert" };
    expect(sampleBookAction(book)).toEqual({
      label: "Coming soon",
      href: null,
    });
    expect(sampleBookAction({ ...book, link: "" })).toEqual({
      label: "Coming soon",
      href: null,
    });
    expect(sampleBookAction({ ...book, link: "   " })).toEqual({
      label: "Coming soon",
      href: null,
    });
  });
});

describe("coverFieldsFromOpenLibraryDoc", () => {
  it("returns no fields when the doc is missing", () => {
    expect(coverFieldsFromOpenLibraryDoc(undefined)).toEqual({});
    expect(coverFieldsFromOpenLibraryDoc({})).toEqual({});
  });

  it("maps cover_i and the first isbn", () => {
    expect(
      coverFieldsFromOpenLibraryDoc({
        cover_i: 240727,
        isbn: ["9780593135204", "0593135202"],
      }),
    ).toEqual({
      image: "https://covers.openlibrary.org/b/id/240727-L.jpg",
      isbn: "9780593135204",
    });
  });

  it("omits isbn when the isbn array is empty and still maps cover_i 0", () => {
    expect(coverFieldsFromOpenLibraryDoc({ cover_i: 0, isbn: [] })).toEqual({
      image: "https://covers.openlibrary.org/b/id/0-L.jpg",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/sampleLibrary.test.ts`

Expected: FAIL. Vitest cannot resolve `@/lib/sampleLibrary`.

- [ ] **Step 3: Write the catalog and helpers**

Create `src/lib/sampleLibrary.ts`:

```ts
export type SampleBook = {
  title: string;
  author: string;
  isbn?: string;
  image?: string;
  link?: string;
};

export type SampleBookAction =
  | { label: "Select"; href: string }
  | { label: "Coming soon"; href: null };

export function sampleBookAction(book: SampleBook): SampleBookAction {
  const raw = book.link ?? "";
  if (!raw.trim()) return { label: "Coming soon", href: null };
  return { label: "Select", href: raw };
}

export type OpenLibrarySearchDoc = {
  cover_i?: number;
  isbn?: string[];
};

export function coverFieldsFromOpenLibraryDoc(
  doc: OpenLibrarySearchDoc | undefined,
): { image?: string; isbn?: string } {
  if (!doc) return {};
  const fields: { image?: string; isbn?: string } = {};
  if (typeof doc.cover_i === "number") {
    fields.image = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }
  if (Array.isArray(doc.isbn) && doc.isbn.length > 0) {
    fields.isbn = doc.isbn[0];
  }
  return fields;
}

export const sampleLibrary: SampleBook[] = [
  // SAMPLE_LIBRARY_START
  { title: "Project Hail Mary", author: "Andy Weir" },
  { title: "The Wheel of Time (Series)", author: "Robert Jordan" },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams" },
  { title: "Good Omens", author: "Terry Pratchett and Neil Gaiman" },
  { title: "Dune", author: "Frank Herbert" },
  { title: "The Witch", author: "Freida McFadden" },
  { title: "Verity", author: "Colleen Hoover" },
  { title: "The Silent Patient", author: "Alex Michaelides" },
  { title: "World War Z", author: "Max Brooks" },
  { title: "Tom Lake", author: "Ann Patchett" },
  { title: "The Midnight Library", author: "Matt Haig" },
  { title: "The Dutch House", author: "Ann Patchett" },
  { title: "Harry Potter and the Deathly Hallows", author: "J.K. Rowling" },
  { title: "The Odyssey", author: "Homer" },
  { title: "The Woman in Me", author: "Britney Spears" },
  { title: "Born a Crime", author: "Trevor Noah" },
  { title: "A Promised Land", author: "Barack Obama" },
  { title: "Atomic Habits", author: "James Clear" },
  { title: "Everything Is Tuberculosis", author: "John Green" },
  { title: "Range", author: "David Epstein" },
  // SAMPLE_LIBRARY_END
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/sampleLibrary.test.ts`

Expected: PASS. Three suites, six tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sampleLibrary.ts tests/lib/sampleLibrary.test.ts
git commit -m "$(cat <<'EOF'
test: add the sample library catalog and select rules

EOF
)"
```

---

### Task 2: Store Open Library covers on the catalog

**Files:**
- Create: `scripts/fill-sample-covers.ts`
- Modify: `src/lib/sampleLibrary.ts` (the array between the markers only)

**Interfaces:**
- Consumes: `sampleLibrary`, `coverFieldsFromOpenLibraryDoc`, and `OpenLibrarySearchDoc` from `src/lib/sampleLibrary.ts`
- Produces: the same `sampleLibrary` export, with `image` and `isbn` filled where Open Library returned them. Existing `link` values are copied through. Titles, authors, and order stay the same. The markers stay in the file.

- [ ] **Step 1: Write the fill script**

Create `scripts/fill-sample-covers.ts`:

```ts
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
```

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/fill-sample-covers.ts`

Expected: twenty log lines, one per title, each ending in `cover`, `no cover`, or `failed (...)`. The process exits 0. `src/lib/sampleLibrary.ts` still exports `sampleBookAction` and `coverFieldsFromOpenLibraryDoc`. The array is still wrapped by `// SAMPLE_LIBRARY_START` and `// SAMPLE_LIBRARY_END`. Books that Open Library matched now have `image` starting with `https://covers.openlibrary.org/b/id/` and ending with `-L.jpg`. `link` is still absent on every record.

- [ ] **Step 3: Re-run the catalog tests**

Run: `npx vitest run tests/lib/sampleLibrary.test.ts`

Expected: PASS. The catalog test still sees twenty titles in order and no `link` fields.

- [ ] **Step 4: Commit**

```bash
git add scripts/fill-sample-covers.ts src/lib/sampleLibrary.ts
git commit -m "$(cat <<'EOF'
feat: store sample library cover URLs from Open Library

EOF
)"
```

---

### Task 3: Library section on the homepage

**Files:**
- Create: `src/components/library/SampleLibrary.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `SampleBook`, `sampleBookAction`, and `sampleLibrary` from `src/lib/sampleLibrary.ts`. `coverGradientFromSeed` from `src/lib/ui/coverGradient.ts`. `GlassCard` from `src/components/ui/GlassCard.tsx`. `Button` from `src/components/ui/Button.tsx`.
- Produces: `export function SampleLibrary({ books }: { books: SampleBook[] })`

- [ ] **Step 1: Add the library component**

Create `src/components/library/SampleLibrary.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { coverGradientFromSeed } from "@/lib/ui/coverGradient";
import { sampleBookAction, type SampleBook } from "@/lib/sampleLibrary";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";

const selectClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-onAccent shadow-[0_4px_14px_-4px_rgba(13,148,136,0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function SampleBookTile({ book }: { book: SampleBook }) {
  const [failed, setFailed] = useState(false);
  const action = sampleBookAction(book);
  const showImage = Boolean(book.image) && !failed;
  const { from, to } = coverGradientFromSeed(book.title);
  const isbn = book.isbn?.trim() ?? "";

  return (
    <li className="h-full">
      <GlassCard className="flex h-full flex-col">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored Open Library URL, not next/image
          <img
            src={book.image}
            alt={book.title}
            className="aspect-[2/3] w-full rounded-xl object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="aspect-[2/3] w-full rounded-xl"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
            aria-hidden
          />
        )}
        <h3 className="mt-4 font-display line-clamp-2 text-base font-semibold tracking-tight text-ink-primary">
          {book.title}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">{book.author}</p>
        {isbn ? (
          <p className="mt-1 text-xs text-ink-muted">ISBN {isbn}</p>
        ) : null}
        <div className="mt-auto pt-4">
          {action.href ? (
            <Link href={action.href} className={selectClass}>
              {action.label}
            </Link>
          ) : (
            <Button type="button" disabled className="w-full">
              {action.label}
            </Button>
          )}
        </div>
      </GlassCard>
    </li>
  );
}

export function SampleLibrary({ books }: { books: SampleBook[] }) {
  if (books.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-primary">
        Library
      </h2>
      <p className="mt-2 text-sm text-ink-muted md:text-base">
        Finished samples you can open and judge.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {books.map((book) => (
          <SampleBookTile key={book.title} book={book} />
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Render the library under the upload form**

Replace `src/app/page.tsx` with:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { SampleLibrary } from "@/components/library/SampleLibrary";
import { sampleLibrary } from "@/lib/sampleLibrary";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { GlassCard } from "@/components/ui/GlassCard";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pdf || !email) {
      setError("PDF and email are required.");
      return;
    }
    setLoading(true);
    const form = new FormData();
    form.append("pdf", pdf);
    form.append("email", email);
    if (voice) form.append("voice", voice);

    const res = await fetch("/api/jobs", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Upload failed");
      return;
    }
    router.push(`/jobs/${data.jobId}/review`);
  }

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-4 pb-12 sm:px-6">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl lg:text-[2.75rem]">
            Turn your PDF into an audiobook
          </h1>
          <p className="mt-3 text-sm text-ink-muted md:text-base">
            Upload a text PDF. Optional narrator voice: 15–20 seconds for a custom
            tone.
          </p>
        </div>

        <GlassCard accent>
          <form onSubmit={onSubmit} className="space-y-6">
            <label className="block text-sm">
              <span className="text-ink-primary">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </label>

            <FileDropzone
              label="PDF"
              accept="application/pdf"
              file={pdf}
              onFile={setPdf}
              hint="Text-based PDF required"
            />

            <FileDropzone
              label="Narrator voice sample (optional)"
              accept="audio/*"
              file={voice}
              onFile={setVoice}
              hint="15–20 seconds of clear speech"
            />

            {error && <p className="text-sm text-semantic-error">{error}</p>}

            <Button
              type="submit"
              disabled={loading}
              className="w-full gap-2 md:w-auto md:max-w-xs"
            >
              {loading ? (
                "Uploading…"
              ) : (
                <>
                  <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                  Generate audiobook
                </>
              )}
            </Button>
          </form>
        </GlassCard>
      </main>
      <SampleLibrary books={sampleLibrary} />
    </>
  );
}
```

- [ ] **Step 3: Check the homepage in the browser**

Run: `npm run dev`

Open `http://localhost:3000`. Confirm:

- The upload form is still the narrow column, and the library sits below it.
- The heading is `Library` and the line under it is `Finished samples you can open and judge.`
- Twenty tiles show, in the catalog order. Each shows a cover or a gradient, the title, and the author. ISBN appears only on tiles whose record has an isbn.
- Every Select control reads `Coming soon`, is disabled, and does not navigate.
- Temporarily set the first record's `image` to `https://example.invalid/missing.jpg`, reload, and confirm that tile shows the gradient. Restore the Open Library URL.
- Temporarily set the first record's `link` to `/jobs/13`, reload, and confirm Select navigates to `/jobs/13`. Remove that `link` before committing.
- Temporarily render `<SampleLibrary books={[]} />`, reload, and confirm the Library heading is gone. Restore `books={sampleLibrary}`.

- [ ] **Step 4: Run the catalog tests again**

Run: `npx vitest run tests/lib/sampleLibrary.test.ts`

Expected: PASS. No record has a `link`.

- [ ] **Step 5: Commit**

```bash
git add src/components/library/SampleLibrary.tsx src/app/page.tsx src/lib/sampleLibrary.ts
git commit -m "$(cat <<'EOF'
feat: show the sample library under the upload form

EOF
)"
```

Only include `src/lib/sampleLibrary.ts` in this commit if a temporary link or image edit was reverted and the file differs from Task 2. If it is unchanged, leave it out.
