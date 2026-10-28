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
  { title: "Project Hail Mary", author: "Andy Weir", image: "https://covers.openlibrary.org/b/id/11200092-L.jpg" },
  { title: "The Wheel of Time (Series)", author: "Robert Jordan", image: "https://covers.openlibrary.org/b/id/10843875-L.jpg" },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", image: "https://covers.openlibrary.org/b/id/12986869-L.jpg" },
  { title: "Good Omens", author: "Terry Pratchett and Neil Gaiman" },
  { title: "Dune", author: "Frank Herbert", image: "https://covers.openlibrary.org/b/id/11481354-L.jpg" },
  { title: "The Witch", author: "Freida McFadden", image: "https://covers.openlibrary.org/b/id/15268299-L.jpg" },
  { title: "Verity", author: "Colleen Hoover", image: "https://covers.openlibrary.org/b/id/8747160-L.jpg" },
  { title: "The Silent Patient", author: "Alex Michaelides", image: "https://covers.openlibrary.org/b/id/9407338-L.jpg" },
  { title: "World War Z", author: "Max Brooks", image: "https://covers.openlibrary.org/b/id/168106-L.jpg" },
  { title: "Tom Lake", author: "Ann Patchett", image: "https://covers.openlibrary.org/b/id/13454692-L.jpg" },
  { title: "The Midnight Library", author: "Matt Haig", image: "https://covers.openlibrary.org/b/id/10313767-L.jpg" },
  { title: "The Dutch House", author: "Ann Patchett", image: "https://covers.openlibrary.org/b/id/8788823-L.jpg" },
  { title: "Harry Potter and the Deathly Hallows", author: "J.K. Rowling", image: "https://covers.openlibrary.org/b/id/15158660-L.jpg" },
  { title: "The Odyssey", author: "Homer", image: "https://covers.openlibrary.org/b/id/12474938-L.jpg" },
  { title: "The Woman in Me", author: "Britney Spears", image: "https://covers.openlibrary.org/b/id/14538012-L.jpg" },
  { title: "Born a Crime", author: "Trevor Noah", image: "https://covers.openlibrary.org/b/id/8294078-L.jpg" },
  { title: "A Promised Land", author: "Barack Obama", image: "https://covers.openlibrary.org/b/id/10449357-L.jpg" },
  { title: "Atomic Habits", author: "James Clear", image: "https://covers.openlibrary.org/b/id/12539702-L.jpg" },
  { title: "Everything Is Tuberculosis", author: "John Green", image: "https://covers.openlibrary.org/b/id/14853332-L.jpg" },
  { title: "Range", author: "David Epstein", image: "https://covers.openlibrary.org/b/id/8782615-L.jpg" },
  // SAMPLE_LIBRARY_END
];
