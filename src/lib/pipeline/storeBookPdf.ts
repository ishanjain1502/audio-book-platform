import { getBook } from "@/lib/book/meta";
import { getDb } from "@/lib/db/client";
import { bookPdfAccessUrl, bookPdfObjectKey } from "@/lib/storage/keys";
import type { Storage } from "@/lib/storage/types";

export async function storeBookPdf(
  bookId: number,
  pdf: Buffer,
  storage: Storage,
): Promise<{ uploaded: boolean; objectKey: string }> {
  const existing = getBook(bookId);
  if (!existing) throw new Error(`Book ${bookId} not found`);
  if (existing.pdfObjectKey) {
    return { uploaded: false, objectKey: existing.pdfObjectKey };
  }
  const objectKey = bookPdfObjectKey(bookId);
  await storage.put(objectKey, pdf, "application/pdf");
  getDb()
    .prepare(
      `UPDATE books
       SET pdf_object_key = ?, pdf_access_url = ?, pdf_uploaded_at = ?
       WHERE id = ?`,
    )
    .run(objectKey, bookPdfAccessUrl(bookId), new Date().toISOString(), bookId);
  return { uploaded: true, objectKey };
}
