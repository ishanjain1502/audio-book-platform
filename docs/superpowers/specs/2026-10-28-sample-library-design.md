# Homepage sample library — design spec

**Status:** Approved (2026-10-28)

## Goals

- Show a library of finished sample audiobooks under the homepage upload form.
- Load that library from a static array of book records.
- Let a visitor open a sample with Select when the record has a link.
- Show the same control as disabled "Coming soon" until a link is added.

## Non-goals

- Creating jobs, generating audio, or changing the job page.
- Fetching covers or book data when the page loads.
- Editing the catalog from the UI.
- ISBN lookup beyond what the one-time cover search returns.
- A new button component. Select reuses the existing primary button styles.

## Decisions

| Topic | Choice |
| --- | --- |
| Catalog | `src/lib/sampleLibrary.ts` exports `SampleBook` and `sampleLibrary`. `src/data/` stays gitignored |
| Records | The twenty books listed below, in that order |
| Cover URLs | Looked up once from Open Library and stored on `image` |
| Runtime fetch | None. The page only reads the array |
| Placement | Under the upload form. The form stays `max-w-lg`. The library is `max-w-5xl` |
| Component | `src/components/library/SampleLibrary.tsx` |
| Select with a link | Primary control labeled Select. It navigates to `link` |
| Select without a link | Disabled control labeled Coming soon. It is not a link |
| Missing cover | Title-seeded gradient from `coverGradientFromSeed` |
| Tests | Vitest on the pure action helper. The grid is checked in the browser |

## Catalog

```ts
type SampleBook = {
  title: string;
  author: string;
  isbn?: string;
  image?: string;
  link?: string;
};
```

`title` and `author` are required. `isbn`, `image`, and `link` are omitted when unknown. A blank or whitespace-only `link` counts as unknown.

Starter records, in order:

1. Project Hail Mary — Andy Weir
2. The Wheel of Time (Series) — Robert Jordan
3. The Hitchhiker's Guide to the Galaxy — Douglas Adams
4. Good Omens — Terry Pratchett and Neil Gaiman
5. Dune — Frank Herbert
6. The Witch — Freida McFadden
7. Verity — Colleen Hoover
8. The Silent Patient — Alex Michaelides
9. World War Z — Max Brooks
10. Tom Lake — Ann Patchett
11. The Midnight Library — Matt Haig
12. The Dutch House — Ann Patchett
13. Harry Potter and the Deathly Hallows — J.K. Rowling
14. The Odyssey — Homer
15. The Woman in Me — Britney Spears
16. Born a Crime — Trevor Noah
17. A Promised Land — Barack Obama
18. Atomic Habits — James Clear
19. Everything Is Tuberculosis — John Green
20. Range — David Epstein

`link` stays unset on every record until a finished job is assigned, for example `/jobs/13`.

### Cover lookup

During implementation, each record is searched once:

`https://openlibrary.org/search.json?title={title}&author={author}&limit=1`

Use the title and author as written. Do not rewrite a title to improve the match.

The search body has a `docs` array. Use `docs[0]` only.

- When `docs[0].cover_i` is present, set `image` to `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg`.
- When `docs[0].isbn` is a non-empty array, set `isbn` to `isbn[0]`.
- When `docs` is empty, `cover_i` is missing, or the request fails, omit `image`. When `docs` is empty, `isbn` is missing, or the request fails, omit `isbn`. Continue with the remaining books.

The stored strings are what the page renders. A later link edit does not repeat the search.

## Page

`src/app/page.tsx` keeps the current upload form inside its narrow `main`. Below that `main`, it renders `<SampleLibrary books={sampleLibrary} />`.

The library section:

- Heading: Library
- Line under the heading: Finished samples you can open and judge.
- Grid: two columns by default, three from the `sm` breakpoint, four from the `lg` breakpoint.
- An empty `books` array renders nothing, including the heading.

## Tiles

Each record is one glass card.

- Cover area is portrait. An `image` URL is a plain `img` with `alt` set to the title. Do not use `next/image`.
- If `image` is missing, or the image fires `onError`, the cover area shows `coverGradientFromSeed(title)` and no broken-image icon.
- Title, then author.
- ISBN on its own line only when `isbn` is a non-empty string.
- The action control sits at the bottom of the card.

`sampleBookAction(book)` lives next to the catalog and returns one of:

- `{ label: "Select", href: book.link }` when `link` is non-empty after trim
- `{ label: "Coming soon", href: null }` otherwise

The tile uses that result. A non-null `href` is a Next.js `Link` with the existing primary button classes. That `href` may be an app path or an absolute URL. A null `href` is the existing `Button`, `disabled`, with no navigation.

## Testing

Vitest covers `sampleBookAction`:

- A non-empty `link` returns Select and that href, including an app path such as `/jobs/13`.
- A missing `link`, `""`, and a whitespace-only `link` each return Coming soon and `href: null`.

The homepage is checked in the browser: the twenty tiles render under the form, a tile without a link shows disabled Coming soon, and a broken cover URL shows the gradient.
