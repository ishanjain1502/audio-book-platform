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
