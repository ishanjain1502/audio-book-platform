import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env") });

import { annotateParagraph } from "../src/lib/annotate/screenplay";
import { loadCharacterMaps } from "../src/lib/book/characterMapsDb";
import { speakerMapForChapter } from "../src/lib/voices/assign";
import { closeDb, getDb } from "../src/lib/db/client";
import { splitIntoParagraphs } from "../src/lib/pdf/chapters";

const db = getDb();
const job = db.prepare("SELECT book_id FROM jobs WHERE id=1").get() as {
  book_id: number;
};
const ch = db
  .prepare("SELECT text FROM chapters WHERE job_id=1 AND idx=0")
  .get() as { text: string };
const assigned = loadCharacterMaps(job.book_id)!;
const speakerMap = speakerMapForChapter(assigned);
const paragraphs = splitIntoParagraphs(ch.text);
console.log("paragraph count", paragraphs.length, "len0", paragraphs[0]?.length);
closeDb();

const sample = paragraphs[0].slice(0, 800);
annotateParagraph({
  paragraph: sample,
  prev: null,
  next: null,
  speakerMap,
})
  .then((r) => {
    console.log("annotated length", r.annotated.length);
  })
  .catch((e) => console.error(e));
