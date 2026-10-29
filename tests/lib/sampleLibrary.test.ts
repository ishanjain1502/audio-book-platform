import { describe, expect, it } from "vitest";
import {
  coverFieldsFromOpenLibraryDoc,
  sampleBookAction,
  sampleLibrary,
} from "@/lib/sampleLibrary";

describe("sampleLibrary", () => {
  it("requires a title and author, and treats a stored link as Select", () => {
    expect(sampleLibrary.length).toBeGreaterThan(0);

    for (const book of sampleLibrary) {
      expect(book.title.trim().length).toBeGreaterThan(0);
      expect(book.author.trim().length).toBeGreaterThan(0);

      const action = sampleBookAction(book);
      if (book.link === undefined) {
        expect(action).toEqual({ label: "Coming soon", href: null });
      } else {
        expect(book.link.trim().length).toBeGreaterThan(0);
        expect(action).toEqual({ label: "Select", href: book.link });
      }
    }
  });
});

describe("sampleBookAction", () => {
  const book = { title: "Any title", author: "Any author" };

  it("returns Select and the link href", () => {
    expect(sampleBookAction({ ...book, link: "/jobs/13" })).toEqual({
      label: "Select",
      href: "/jobs/13",
    });
    expect(
      sampleBookAction({ ...book, link: "https://example.com/book.mp3" }),
    ).toEqual({
      label: "Select",
      href: "https://example.com/book.mp3",
    });
  });

  it("returns Coming soon when the link is missing, blank, or whitespace", () => {
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
