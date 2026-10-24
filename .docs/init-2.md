Got it—those five answers materially tighten the spec. I'll translate them into concrete build decisions below, flag the one that adds real risk (web research), and close with the revised schema and open items.

## What changes vs. the previous plan

### 1. Commandcode → DeepSeek V4 Flash for annotation
Good fit for a 1-day build because it is **fast, cheap, and has native JSON mode**—$0.13/M input and $0.28/M output tokens, with a **1M-token context window**. Two constraints to design around:

- **Structured Outputs are not supported, but JSON Mode is**. So you cannot force a strict schema; you can only ask for JSON and validate it yourself. For the character map and screenplay passes, use `response_format: { type: "json_object" }` and write a small validator that rejects malformed output and retries once with the error message appended to the prompt.
- **Max output is ~393K tokens**. That is plenty for chapter-level annotation, but **do not** ask one call to annotate an entire chapter in one response. Keep paragraph-batch granularity as you planned.

### 2. Web research for character maps instead of text sampling
This is viable, but it is the **highest-variance piece** in the MVP. I'd treat it as a **first-choice path with a deterministic fallback**, not the only path.

**How I'd wire it:**

1. **Extract book identity**: title, author, and any subtitle from the PDF metadata or the first page.
2. **Search** a small set of sources: Wikipedia, Fandom wikis, Goodreads, and publisher pages. Use a search API (e.g. Brave/Serper/Tavily) and take the top 3–5 results.
3. **Fetch and summarize**: send the page snippets to DeepSeek V4 Flash with the prompt: “Extract every named character who speaks or materially affects delivery. Return name, role, gender presentation if stated, age impression if stated, 3–5 tonality adjectives, and a confidence score. Only include facts supported by the sources.”
4. **Fallback rule**: if fewer than 2 sources are found, or the confidence scores are low, fall back to **text sampling**: send the first 20% of the book plus the most dialogue-dense chapters to the same prompt. This keeps the pipeline unblocked for unknown or self-published books.

**Risk to flag:** web research can pull **spoilers** or **film-adaptation characterizations** that differ from the book. For a toy project this is acceptable, but the prompt should say “prioritize the book's own characterization over adaptations” and return a `source` field per character so you can debug.

### 3. Voice sample: 15 seconds target, 30 seconds hard max
This matches Drama 3's cloning range. One result says cloning supports **10–30 second reference clips**, and another notes that takes over 15 seconds are often truncated to 15 for reference use. So your **15s target / 30s max** is aligned with the model.

**Build rule:** validate duration server-side before sending to Fish Audio. If >30s, reject with a clear error; if between 15s and 30s, optionally trim to 15s to match the common reference convention. If <10s, reject—too short for reliable cloning.

### 4. Ten paragraphs annotated in parallel
This is fine, but **separate two concurrency limits**:

| Layer | Concurrency | Why |
|---|---|---|
| DeepSeek V4 Flash annotation | 10 parallel paragraph calls | Cheap and fast; 10 is well within rate limits. |
| Fish Audio Drama 3 synthesis | Start at **5**, ramp to 10 | Drama 3 is in gated preview and rate limits may be tighter than the docs suggest. |

If you use the same 10-way semaphore for both, you risk 429s on the Fish Audio side while annotation is healthy. Use **separate queues** with independent backoff.

### 5. SQLite caching of character maps
Good—SQLite is the right call for a 1-day build. The cache key should be **`book_fingerprint`**, not just title, so different editions or uploads of the same book do not collide.

**Minimum schema:**

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT,
  author TEXT,
  fingerprint TEXT UNIQUE,  -- hash of normalized first 5k words + title
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE character_maps (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books(id),
  character_name TEXT,
  role TEXT,
  tonality_json TEXT,        -- array of adjectives
  confidence REAL,
  source TEXT,               -- 'web' or 'text_sample'
  assigned_voice_id TEXT,    -- nullable until voice assignment
  UNIQUE(book_id, character_name)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  book_id INTEGER,
  status TEXT,               -- queued | processing | done | failed
  email TEXT,
  created_at DATETIME,
  completed_at DATETIME
);
```

On upload: compute `fingerprint` → check `books` → if exists, reuse `character_maps`; if not, run the research/sampling pass and insert.

## Updated pipeline (1-day MVP)

```
PDF upload
  → text extraction + chapter split
  → book fingerprint → SQLite lookup
       ├─ hit  → reuse character map + voice assignments
       └─ miss → web research (3–5 sources)
                   ├─ success → character map → voice assignment → cache
                   └─ fail    → text sampling (20% + dialogue chapters)
  → screenplay pass: 10 paragraphs at a time via DeepSeek V4 Flash (JSON mode)
       → each paragraph → Drama 3-ready string with <|speaker:N|> and directions
  → Drama 3 synthesis (separate queue, 5→10 concurrency)
       → per-paragraph MP3 chunks
  → stitch per chapter → chaptered MP3s → email notification
```

## Three spec-level decisions you still need to make

1. **Voice library for web-researched characters.** You said "associate a voice before generation." For web-research characters, the voice library must cover common archetypes (male/female × young/mature × warm/gravelly/authoritative). **How many sample voices** do you want to curate for day one—8, 12, or more? This directly affects how often two characters collide.

2. **Web search provider.** Do you already have a Brave/Serper/Tavily key, or should the spec assume one is provisioned? If none, the fallback-to-text-sampling path becomes the **default**, not the exception.

3. **What happens when the PDF has no detectable chapter headings?** For the MVP, do you want to split by a fixed word count (e.g. 3,000-word chunks) and label them "Section 1, Section 2…", or fail the job with a clear error? I'd recommend **fixed-count sections** so the pipeline never dead-ends.

Once you confirm the voice-library size and search-provider availability, the next artifact should be the **two prompts** (character-map research prompt and paragraph screenplay prompt) plus the **Drama 3 request wrapper** with JSON-mode validation and the 5→10 concurrency ramp. Those are the three pieces the rest of the sprint depends on.

---

With those four decisions locked, the remaining ambiguity is mostly around **voice curation** and **how the web-research path behaves when it fails**. I've pulled the Drama 3 docs and Fish Audio voice references to make the voice selection concrete.

Here's the finalized spec delta, followed by the three things I'd still nail down before you start coding.

## 1. Concurrency: separate 5+5 queues

You said "5 and 5 parallel" for annotation and audio generation. That is the right call. Build them as **two independent async queues** rather than one shared semaphore.

| Queue | Concurrency | Why separate |
|---|---|---|
| DeepSeek V4 Flash annotation (Commandcode) | 5 | Cheap and fast; 5 is well within rate limits and keeps token burn predictable. |
| Fish Audio Drama 3 synthesis | 5 | Drama 3 is in gated preview, so rate limits are tighter than the docs suggest. Starting at 5 protects you from 429 storms while you observe real limits. |

Both queues should use **exponential backoff with jitter** and a **dead-letter log** per failed paragraph, so one bad chunk does not stall the whole chapter.

## 2. Voice selection: a concrete starter library

Fish Audio exposes public system voices via `voices.list(self_only=False)`, and any public voice ID works directly as `reference_id` in a Drama 3 request. The Drama 3 docs name three public voices with their IDs:

| Voice | Language | ID |
|---|---|---|
| Adrian | EN-US, male | `bf322df2096a46f18c579d0baa36f41d` |
| Delia | EN-US, female | `c70cfb98867a4bfb9ae20d2401257b92` |
| Sheila | EN-US, female | `f3a2b90078d54a65af4b95f63bc7798e` |

Other named Fish Official voices that appear across the public library include **Ethan, Selene, Hannah, Jordan, Laura, Sarah, Brian, Dolly, Sadie, Mila, Kai, and Jonah**. For the 1-day build, I'd curate **10–12 of these** into a static `voices.json` with metadata (gender, age impression, 2–3 adjectives like "warm / authoritative / gravelly") rather than trying to auto-discover them at runtime. Fetch their IDs once via `voices.list()` and hard-code them; this removes a network dependency from the voice-assignment step.

**Assignment logic:**
1. Narrator gets the user-uploaded voice if provided; otherwise it gets the highest-scored "neutral storytelling" voice from the library.
2. Sort remaining characters by narrative importance (protagonist → antagonist → supporting).
3. Greedy-assign the highest-scoring **unused** voice to each character based on tonality-overlap with the character map.
4. If a chapter has more than **16 distinct speakers**, collapse minor characters into a shared "supporting" voice before sending to Drama 3, because the model caps at 16 speaker tags per request.

This directly handles your "create a hashmap and assign each character an audio profile" requirement.

## 3. Web research: prompt strategy and fallback

You're using **Commandcode DeepSeek V4 Flash only** for web search and annotation. Commandcode is an OpenAI-compatible gateway at `https://api.commandcode.ai/provider/v1`, with `deepseek/deepseek-v4-flash` as the default model and a **1M-token context window**. It is cheap enough (~$0.15 input / $0.60 output per 1M tokens) that running the research and annotation passes is not a budget concern.

**Two-call research pattern:**

1. **Search call**: give DeepSeek a tool to search the web (or, if Commandcode does not expose native web search, use a lightweight search API and pass the top 3–5 snippets into the prompt). Ask it to return **only JSON**:
   ```json
   {
     "book_title": "...",
     "characters": [
       {
         "name": "...",
         "role": "narrator | protagonist | antagonist | supporting",
         "gender_presentation": "...",
         "age_impression": "...",
         "tonality": ["...", "..."],
         "confidence": 0.0,
         "source": "wikipedia | goodreads | publisher | text_sample"
       }
     ]
   }
   ```
2. **Fallback call**: if fewer than 2 sources are found, or the average confidence is below ~0.5, re-run the same JSON prompt against a **text sample** (first 20% of the book plus the most dialogue-dense chapters) rather than the full text. This keeps the job unblocked for self-published or obscure books.

Because DeepSeek V4 Flash supports **JSON Mode but not strict Structured Outputs**, validate the response with a schema validator (e.g. Zod in Node.js) and retry once with the validation error appended to the prompt.

**Prompt guardrail for adaptations:** add "Prioritize the book's own characterization over film/TV adaptations" to the system prompt. Web research can pull adaptation characterizations that differ from the source, and this line reduces the risk.

## 4. Chapter splitting: fixed-word-count sections with labels

You said "go with recommended." For the MVP, that means:

- **Prefer TOC-based chapter detection** if the PDF has bookmarks or a clear "Chapter N" regex.
- **Fallback**: split by a fixed **3,000-word count** and label sections "Section 1", "Section 2", etc.
- **Never fail the job** just because chapter headings are missing. A labeled section is always better than a dead end.

This also gives you a predictable unit for the 5-parallel annotation queue: one "section" is the batch boundary, and paragraphs inside it are annotated in groups of 5.

## 5. Updated end-to-end pipeline (final MVP)

```
PDF upload
  → text extraction + TOC/heading split (fallback: 3,000-word sections)
  → fingerprint → SQLite lookup
       ├─ hit  → reuse character map + voice assignments
       └─ miss → DeepSeek V4 Flash web research (JSON mode)
                   ├─ ≥2 sources → character map → voice assignment → cache
                   └─ <2 sources → text-sample character map → cache
  → screenplay pass: 5 paragraphs in parallel via DeepSeek V4 Flash
       → each paragraph → Drama 3-ready string:
         <|speaker:N|>[direction] text <emphasis>word</emphasis>
  → Drama 3 synthesis: 5 parallel requests (reference_id array per scene)
       → per-paragraph MP3 chunks
  → stitch per section/chapter → MP3 → email notify
```

The Drama 3 request shape is the one from the docs: `model: drama-3`, `reference_id: [voiceId0, voiceId1, …]`, and speaker tags `<|speaker:0|>` through `<|speaker:15|>` in the text.

## Three things I'd still nail down before coding

1. **Does Commandcode expose a native web-search tool, or do you need to bolt on a separate search API?** The answer changes the research prompt structure. If Commandcode has no built-in browsing, you'll pass search snippets into the prompt manually.

2. **What happens when the user-uploaded voice sample is 30 seconds exactly?** Fish Audio's cloning best practices say **at least 10 seconds** is the floor and **15–20 seconds per clip** is the recommended range. Your 15s target / 30s max is aligned, but define the validation rule explicitly: reject <10s, trim 15–30s to 15s if you want consistency, reject >30s.

3. **Do you want the character map cached per `book_fingerprint` (hash of normalized first 5k words + title), or per uploaded file?** Fingerprint is better because re-uploads of the same book reuse the map, but it means two different editions with the same opening text may collide. For a toy project, fingerprint is fine.

If you confirm the Commandcode search capability and the voice-sample validation rule, the next artifact should be the **two prompts** (research JSON prompt + paragraph screenplay prompt) and the **Drama 3 request wrapper** with JSON validation and the 5-queue backoff logic. Those three pieces unblock the entire sprint.

---

All four decisions are locked. Below is the final buildable spec — the two prompts, the Drama 3 wrapper, the SQLite schema, and the validation rules — in a form you can hand to Cursor.

One consistency note: your voice-sample rule is now **15–20 seconds only** (earlier it was "15 target, 30 max"). I've written the validator as hard-fail outside 15.0–20.0s, which is stricter and simpler. Also, the exact tag vocabulary (`<whisper>`, `[sigh]`, `<|speaker:N|>`, etc.) and the 16-speaker cap should be re-read off the docs page once at build time and pinned into a constants file, so Cursor isn't guessing from memory.

---

## 1. Validation rules (hard-fail, server-side)

| Rule | Behavior |
|---|---|
| Voice sample duration `< 15.0s` | 400: "Voice sample must be 15–20 seconds. Yours is Xs." |
| Voice sample duration `> 20.0s` | 400: "Voice sample must be 15–20 seconds. Yours is Xs." |
| Voice sample not audio | 400: "Unsupported audio format" |
| PDF has no extractable text | 422: "No text layer found. Scanned PDFs are not supported yet." |
| PDF text `< 500 words` | 422: "PDF too short to generate an audiobook." |
| Paragraph batch produces malformed JSON | Retry once with validation error appended; then mark paragraph failed, continue rest |
| Chapter has `> 16` distinct speakers | Collapse minor characters into `supporting` voice before synthesis |

---

## 2. Voice library: `voices.json`

Do **not** hard-code voice IDs from memory. At build time, call `voices.list(self_only=False)` once, pick 10–12 English voices (including the officially documented ones), and pin the output into a static file. This removes a network dependency from the hot path.

```json
[
  {
    "id": "<from voices.list()>",
    "name": "Adrian",
    "gender": "male",
    "age_impression": "mature",
    "language": "en-US",
    "tags": ["neutral", "warm", "storytelling"],
    "reserved_for": "narrator"
  },
  {
    "id": "<from voices.list()>",
    "name": "Delia",
    "gender": "female",
    "age_impression": "young-adult",
    "language": "en-US",
    "tags": ["bright", "energetic", "friendly"],
    "reserved_for": null
  }
]
```

**Assignment algorithm (deterministic):**

1. `narrator` → user-uploaded cloned voice if present, else the library voice with `reserved_for: "narrator"`.
2. Sort characters: `protagonist` → `antagonist` → `supporting`, ties broken alphabetically (determinism matters for caching).
3. For each, score every **unused** library voice by tag-overlap with the character's `tonality` array; pick the highest. Ties → lowest voice ID.
4. Store the resulting `character_name → voice_id` map in SQLite. This map is the "hashmap" you described and is reused for every chapter of that book.

---

## 3. Prompt A — Character map (research with text-sample fallback)

Single prompt template, two invocation modes. Output must be JSON.

```
SYSTEM:
You are a literary analyst building a character map for an audiobook production.
You will receive either (a) web research snippets about a book, or (b) an excerpt
of the book itself, plus the book's title and author.

Return ONLY valid JSON matching this schema. No markdown, no commentary.

{
  "book_title": string,
  "author": string,
  "mode": "web_research" | "text_sample",
  "sources_found": number,
  "characters": [
    {
      "name": string,
      "aliases": string[],
      "role": "narrator" | "protagonist" | "antagonist" | "supporting",
      "speaks": boolean,          // false for characters only referenced
      "gender_presentation": string | null,
      "age_impression": "child" | "young-adult" | "adult" | "mature" | "elderly" | null,
      "tonality": string[],       // 3-5 adjectives, e.g. ["gravelly","tired","authoritative"]
      "confidence": number,       // 0.0 - 1.0
      "source": string            // url, "wikipedia", "goodreads", or "text_sample"
    }
  ]
}

RULES:
- Only include facts supported by the provided material. Never invent.
- Prioritize the book's own characterization over film/TV/adaptation portrayals.
- `narrator` is the audiobook narrator voice, not a character in the book. Include it
  with role "narrator", speaks=true, tonality describing the book's overall register.
- Include only characters who speak OR whose description materially affects delivery.
- If material is insufficient for a field, use null rather than guessing.
- `confidence` reflects how well-sourced that character's tonality is.

USER:
Book: {title} by {author}
{mode == "web_research" ? "Research snippets:\n" + snippets : "Excerpt:\n" + textSample}
```

**Orchestration:**

```
1. Extract title/author from PDF metadata → first-page regex.
2. mode = "web_research": obtain 3–5 snippets (Commandcode native search if available,
   else a search API behind the same adapter — Cursor decides).
3. Parse + validate with Zod.
4. IF sources_found < 2 OR avg(confidence) < 0.5 → re-run with mode="text_sample",
   where textSample = first 20% of book + the 5 most dialogue-dense chapters
   (count '"' characters per chapter).
5. Persist to SQLite keyed by book fingerprint.
```

---

## 4. Prompt B — Paragraph screenplay annotator

Called 5× in parallel, **one paragraph per call**. Speaker indices must be **global to the chapter**, computed once, and passed in — never re-derived per paragraph, or `<|speaker:N|>` will drift.

```
SYSTEM:
You convert prose into a Drama 3 TTS script. You do not rewrite, summarize, or
abridge. You preserve every word of the input paragraph exactly.

Available Drama 3 syntax:
  [plain-language direction]   placed before a line, e.g. [barely holding it together]
  <whisper> <emphasis> <soft> <fast> <slow> <stress> <forceful>   paired word tags
  [sigh] [laugh] [breath] [pause]                                inline sound/pause tags
  <|speaker:N|>                                                  speaker turn marker

Speaker index map (global for this chapter — use ONLY these):
{speaker_map_json}   // e.g. {"narrator":0,"Elizabeth":1,"Darcy":2}

Return ONLY JSON:
{
  "annotated": string,
  "speakers_used": number[],
  "notes": string | null
}

RULES:
- Start with the correct <|speaker:N|> tag for each speaker turn.
- Narration (non-dialogue) is speaker index 0 unless clearly attributed otherwise.
- Dialogue in quotes → the speaking character's index. Attribute from the surrounding
  attribution clause; if attribution is ambiguous, keep it with the previous speaker.
- Add a [direction] only where it changes delivery. Do not annotate every sentence.
- If unsure about emotion, emit NO direction. Neutral is better than wrong.
- Max 3 directions and 4 paired tags per paragraph. Restraint over density.
- Never add words, never drop words, never fix grammar. Text must be verbatim.
- Never use a speaker index not present in the map.

USER:
Paragraph (context, do not annotate): {prev_paragraph_or_null}
PARAGRAPH TO ANNOTATE:
{paragraph}
Next paragraph (context, do not annotate): {next_paragraph_or_null}
```

**Why context paragraphs are passed read-only:** dialogue attribution ("she said") frequently lives in the adjacent paragraph. Passing ±1 paragraph raises attribution accuracy at ~zero token cost, while the instruction "do not annotate" prevents scope creep.

**Post-validation:**
- Reject if any `<|speaker:N|>` has `N` not in `speaker_map`.
- Reject if the annotated text, with all tags stripped, `!== ` the input paragraph (whitespace-normalized). This catches silent paraphrasing — the single most likely failure mode.
- On rejection: retry once with the diff appended to the prompt; then fall back to **unannotated text with only the speaker tag prepended**.

---

## 5. Drama 3 request wrapper (Node.js sketch)

```js
const DRAMA3 = "drama-3";
const FALLBACK_MODEL = process.env.FISH_FALLBACK_MODEL; // older Fish model, pinned in env
const MAX_CHARS = 2000; // conservative; split paragraphs longer than this

async function synthesize({ annotatedText, referenceIds, model = DRAMA3 }) {
  return retryWithBackoff(async (attempt) => {
    const res = await fetch(`${FISH_BASE}/v1/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FISH_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: annotatedText,
        reference_id: referenceIds, // ordered to match <|speaker:N|>
        model,
        format: "mp3",
      }),
    });
    if (res.status === 429 || res.status >= 500) throw new Retryable(res.status);
    if (!res.ok) throw new Fatal(await res.text());
    return Buffer.from(await res.arrayBuffer());
  }, { attempts: 5, onExhausted: () => synthesize({ annotatedText, referenceIds, model: FALLBACK_MODEL }) });
}
```

**Queue:** 5 workers, shared `p-limit(5)` or a simple token bucket. Failed paragraphs go to a dead-letter table so one bad chunk cannot stall the chapter.

**Ordering and stitching:** keep `(chapter_index, paragraph_index)` on every chunk. Concatenate in index order per chapter. Insert 250 ms of silence between paragraphs only if Drama 3 output lacks natural tail silence — check by measuring trailing low-amplitude duration on a sample first.

---

## 6. SQLite schema (final)

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT, author TEXT,
  fingerprint TEXT UNIQUE NOT NULL,      -- sha256(normalized first 5k words + title)
  page_count INTEGER, word_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE character_maps (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  name TEXT NOT NULL,
  aliases_json TEXT,
  role TEXT, speaks INTEGER,
  gender_presentation TEXT, age_impression TEXT,
  tonality_json TEXT,
  confidence REAL, source TEXT, mode TEXT,
  speaker_index INTEGER,                 -- global index used in <|speaker:N|>
  voice_id TEXT,                         -- from voices.json
  UNIQUE(book_id, name)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books(id),
  email TEXT NOT NULL,
  custom_voice_path TEXT,                -- null if none
  status TEXT NOT NULL,                  -- queued|processing|stitching|done|failed
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  idx INTEGER, title TEXT, text TEXT,
  speaker_count INTEGER
);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER, chapter_idx INTEGER, paragraph_idx INTEGER,
  annotated_text TEXT,
  audio_path TEXT, duration_ms INTEGER,
  status TEXT,                           -- pending|annotated|synthesized|failed
  attempts INTEGER DEFAULT 0, error TEXT,
  UNIQUE(job_id, chapter_idx, paragraph_idx)
);
```

Caching rule: `character_maps` is keyed on `books.fingerprint`, **not** on `job_id`. Re-uploading the same book reuses the map and the voice assignments. Re-running synthesis for an existing fingerprint skips Prompt A entirely.

---

## 7. Build order for Cursor

1. **Constants file** — pin Drama 3 tag vocabulary, speaker cap, char cap, model IDs (read the docs page once).
2. **PDF → chapters** — `pdf-parse`/`pdfjs-dist`; TOC first, "Chapter N" regex second, 3,000-word sections last. Never fail on missing headings.
3. **Fingerprint + SQLite** — `books` lookup, cache hit path returns immediately.
4. **Prompt A + adapter** — one `searchBookInfo(title, author)` adapter with two implementations (native / external API) behind an interface.
5. **Voice assignment** — `voices.json` + greedy scorer; persist `speaker_index` and `voice_id`.
6. **Prompt B + 5-queue** — with the verbatim-check validator and fallback.
7. **Drama 3 wrapper + 5-queue** — with backoff, fallback model, dead-letter.
8. **Stitch + email** — per-chapter MP3s, links in email.
9. **End-to-end on one sample book** — hard-code its character map first to unblock steps 6–8, then verify Prompt A reproduces something close.

---

## Remaining open items (Cursor can decide, but flag the choice in code)

1. **Search adapter**: if Commandcode has native web search, use it; otherwise plug in any search API behind `searchBookInfo()`. The interface is what matters — the implementation is swappable.
2. **`reference_id` semantics**: confirm from the docs whether it's a single string or an array, and whether the array order maps to speaker index or to voice-ID list. The wrapper assumes array-ordered-by-index; if the API differs, only `synthesize()` changes.
3. **Silence between paragraphs**: measure one Drama 3 output before deciding whether to insert 250 ms gaps or trust the model's natural pauses.

With this, the spec is complete enough to hand to Cursor. The riskiest remaining unknowns are all isolated behind the `synthesize()` wrapper and the `searchBookInfo()` adapter, so neither can block the rest of the pipeline.