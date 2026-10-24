Good—this is a tight, buildable MVP. With your answers, the critical path is clear: **PDF → chapter text → character map + voice map → expression-annotated script → Drama 3 → stitched MP3s**. The main design risk is not Drama 3 itself (it already supports exactly what you need), but the **expression layer and the character/voice mapping logic** before synthesis begins.

Below is what I’d lock down for the 1-day build, plus the few remaining questions that will change the spec.

## 1. What Drama 3 gives you (and what it doesn’t)

From the docs, Drama 3 is a good fit for your expression goal because it already exposes the controls you were planning to build around:

- **Plain-language directions in square brackets** before a line: `[barely holding it together, forcing a smile] I’m fine.`
- **Paired word-level tags**: `<whisper>`, `<emphasis>`, `<soft>`, `<fast>`, `<slow>`, `<stress>`, `<forceful>`
- **Sound and pause tags** inline: `[sigh]`, `[laugh]`, `[breath]`, `[pause]`
- **Multi-speaker dialogue in one request**: pass an array of voice IDs in `reference_id`, and use `<|speaker:0|>`, `<|speaker:1|>`, etc. at each turn
- **Up to 16 speaker tags per request** in the API context

So you do **not** need to invent an expression taxonomy from scratch. The expression layer’s job is to **translate the book text into Drama 3’s native direction format** and **assign the correct speaker tag to each line**.

What Drama 3 does **not** solve for you is the **content intelligence**: deciding *which* character is speaking, *what* emotion applies, and *which voice ID* maps to that character. That is where your LLM and character-map pass come in.

## 2. The pipeline you should build (MVP version)

### Stage 1: PDF ingestion and chapter segmentation
- Use a Node.js PDF text library (e.g. `pdf-parse` or `pdfjs-dist`).
- Extract raw text, strip headers/footers/page numbers.
- Detect chapters from the TOC if available; otherwise fall back to heading-style heuristics or simple length-based chunking.
- **Output**: an array of chapters, each with `title` and `rawText`.

### Stage 2: Character map generation (per book)
This is the step that makes the audiobook sound like a performance instead of a read-aloud.

For each book:
1. Run a fast, cheap LLM pass over the full extracted text (or chapter summaries) with a prompt like:
   > “List every distinct character who speaks or is referred to in a way that affects delivery. For each, return: name, role (narrator / protagonist / antagonist / supporting), gender presentation if stated, age impression if stated, and 3–5 adjectives describing their general tonality (e.g. ‘gravelly, tired, in control’). Do not invent; only use what the text supports.”
2. Build a **character → voice profile** map. For the MVP, “voice profile” can be a set of adjectives + gender/age hints, not an actual audio embedding.
3. **Critical**: assign a **unique voice ID** to each major character **before** synthesis starts. Never let the model choose a voice per paragraph—that is how consistency breaks.

For a **sample book** you pre-load, you can hard-code this map. For a **user-uploaded book**, this is the first LLM call and the main latency cost before generation begins.

### Stage 3: Expression annotation (the LLM “screenplay” pass)
This is where you turn prose into a Drama 3-ready script.

Process **chapter by chapter**, but within a chapter process **paragraphs in parallel (10 at once)** as you planned.

For each paragraph, the LLM receives:
- The paragraph text.
- The character map (names → speaker tag indices → voice IDs).
- A **base prompt** describing Drama 3’s direction syntax (square-bracket directions, paired tags, sound tags).
- Instruction: “Return only the annotated text, using `<|speaker:N|>` at each speaker turn, square-bracket directions before lines where delivery matters, and paired tags only on words that need local emphasis. Do not add tags to every sentence—only where it improves expression.”

**Fallback rule** you specified: if the LLM is unsure about emotion, emit **no direction tag** for that line. Drama 3 will read it neutrally, which is better than a wrong strong direction.

**Output per paragraph**: a string already in Drama 3’s input format, e.g.:
```
<|speaker:0|>[calm, measured storyteller voice] The ship had been silent for three days.
<|speaker:1|>[low, gravelly, tired but in control] Status report.
<|speaker:2|>[fast, nervous, stumbling over words] Uh, sir, so, the thing is…
```

### Stage 4: Drama 3 synthesis
- Send each annotated paragraph (or a small batch of consecutive paragraphs from the same speaker) to `POST /v1/tts` with `model: drama-3` and `reference_id: [voiceId0, voiceId1, …]`.
- **Concurrency**: 10 parallel requests is fine at the API level, but you must handle **429 rate limits** with exponential backoff. Drama 3 is in preview, so rate limits may be tighter than the docs suggest. I’d start with **5 concurrent** and ramp to 10 after observing 429s.
- **Model fallback**: if `drama-3` fails repeatedly, fall back to `s2.1-pro` (the older Fish Audio model) as you specified. The request shape is the same; only the model header changes.

### Stage 5: Stitching and delivery
- Receive MP3 chunks per paragraph.
- Concatenate in original order per chapter. Use a small gap (200–400 ms) between paragraphs if the model does not already produce natural pauses.
- Optionally add a short chapter intro/outro (e.g. “Chapter 3”).
- Upload final MP3s and send the user an email with download links.

## 3. The voice-mapping problem (this will make or break the MVP)

Your plan is: **before generation, associate each character with a voice from a sample library, ensuring no two characters share the same voice**. That is the right approach, but the selection logic needs to be deterministic enough for a 1-day build.

For the MVP I’d do this:

1. **Curate a small voice library** (10–15 Fish Audio public voices) with metadata: gender, accent, age impression, and 2–3 adjectives (e.g. “warm, mature, calm”).
2. **Score each character against each voice** using the character’s adjectives from Stage 2. A simple keyword-overlap or embedding similarity is enough—do not build a complex ranking model on day one.
3. **Greedy assignment**: sort characters by importance (narrator first, then protagonists), and for each, pick the highest-scoring **unused** voice.
4. **Narrator special case**: if the user uploads a custom voice sample, that becomes the narrator voice. All character voices must be distinct from it.
5. **Minor characters**: if there are more characters than voices, allow reuse only for characters who never appear in the same scene. For the MVP, you can collapse minor characters into a generic “supporting” voice.

**Key constraint**: Drama 3 supports **up to 16 speaker tags per request**. If a chapter has more than 16 distinct speakers, you must split the request into multiple requests and stitch, or collapse minor characters. For most books this will not happen, but your code should check and handle it.

## 4. Critical risks for a 1-day build

### Risk 1: The character map LLM pass is slow and token-heavy
Reading an 80,000-word book into an LLM is expensive and slow. For the MVP:
- **Do not** send the full book in one prompt. Send **chapter summaries** first, or the first N chapters plus the character-list prompt.
- For user-uploaded books, generate the character map from a **sample of the text** (e.g. first 20% + all dialogue-dense sections) rather than the full text.
- Accept that the character map will be imperfect. You can let the expression LLM correct obvious speaker attribution during the screenplay pass.

### Risk 2: Drama 3 is in preview
The docs say “currently in preview”. Expect occasional failures, changed behavior, or stricter rate limits. Your code must:
- Retry with exponential backoff on 429 and 5xx.
- Fall back to `s2.1-pro` after N failures.
- Log the raw request and response for every failed chunk so you can debug.

### Risk 3: PDF chapter detection is messy
Even “born-digital” PDFs often have inconsistent heading styles. For the MVP:
- Prefer TOC-based chapter splitting if the PDF has bookmarks.
- Otherwise, use a regex for “Chapter N” / “CHAPTER N” headings, and fall back to splitting at large paragraph gaps.
- **Do not** try to handle tables, footnotes, or multi-column layouts on day one—you already said “text only” for the MVP.

### Risk 4: Cost is manageable, but monitor it
Drama 3 is **$50 per million UTF-8 bytes** list, or **$10/M during the launch promotion until Nov 12, 2026**. 1M bytes ≈ 180,000 English words. An 80,000-word book is roughly 0.45M bytes → **~$22.50 at list, ~$4.50 at promo**. That is fine for a toy project, but log token counts and bytes per job so you do not get surprised.

## 5. What I’d build in the 1-day sprint (concrete order)

1. **Hour 0–2**: PDF extraction + chapter splitter. Test on 2–3 sample PDFs.
2. **Hour 2–4**: Character map prompt + voice library + assignment logic. Hard-code a character map for one sample book to unblock downstream work.
3. **Hour 4–6**: Expression annotation prompt + parallel paragraph processor with 429 backoff.
4. **Hour 6–8**: Drama 3 API integration, single-paragraph synthesis first, then batch.
5. **Hour 8–10**: Stitching, MP3 export, email notification stub.
6. **Hour 10–12**: End-to-end run on a sample book; fix the top 3 failures.

## 6. Remaining questions (these affect the spec)

1. **What is “commandcode”?** You mentioned it as the stack for expression generation. Is it a specific internal LLM, a model provider, or a code-generation tool? This determines the prompt format and API integration.
2. **For a user-uploaded book, how much text should the character-map pass read?** Full book (slow/expensive) or a sampled portion (fast but less accurate)? For the MVP I’d strongly recommend sampled.
3. **What happens if the user’s uploaded voice sample is too long or too short?** You said “30 seconds max”—is that a hard limit, and do you validate it client-side or server-side?
4. **Do you want the expression LLM to annotate the entire book before synthesis starts, or stream chapter-by-chapter?** Chapter-by-chapter is much better for perceived latency and failure isolation.
5. **For the sample books, do you already have the character/voice maps, or should the system generate them on first run and cache them?**

Once you confirm these, the next step is to write the **two core prompts** (character map + expression annotation) and the **Drama 3 request wrapper** with fallback. Those are the three pieces that everything else depends on.