export function bookPdfObjectKey(bookId: number): string {
  return `books/${bookId}/source.pdf`;
}

export function bookPdfAccessUrl(bookId: number): string {
  return `/api/books/${bookId}/pdf`;
}
