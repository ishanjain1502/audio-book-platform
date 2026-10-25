import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env") });

import { splitIntoParagraphs } from "../src/lib/pdf/chapters";
import { closeDb, getDb } from "../src/lib/db/client";

const db = getDb();
const ch = db
  .prepare("SELECT text FROM chapters WHERE job_id=1 AND idx=0")
  .get() as { text: string };
const p = splitIntoParagraphs(ch.text);
console.log("paragraphs ch0", p.length);
closeDb();
