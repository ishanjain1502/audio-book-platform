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
