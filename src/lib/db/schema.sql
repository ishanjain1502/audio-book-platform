CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT,
  author TEXT,
  fingerprint TEXT UNIQUE NOT NULL,
  page_count INTEGER,
  word_count INTEGER,
  pdf_object_key TEXT,
  pdf_access_url TEXT,
  pdf_uploaded_at TEXT,
  researched_at TEXT,
  research_mode TEXT,
  research_started_at TEXT,
  research_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS character_maps (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  name TEXT NOT NULL,
  aliases_json TEXT,
  role TEXT,
  speaks INTEGER,
  gender_presentation TEXT,
  age_impression TEXT,
  tonality_json TEXT,
  confidence REAL,
  source TEXT,
  mode TEXT,
  speaker_index INTEGER,
  voice_id TEXT,
  UNIQUE(book_id, name)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books(id),
  email TEXT NOT NULL,
  custom_voice_path TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  idx INTEGER,
  title TEXT,
  text TEXT,
  speaker_count INTEGER,
  reviewed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER,
  chapter_idx INTEGER,
  paragraph_idx INTEGER,
  annotated_text TEXT,
  audio_path TEXT,
  duration_ms INTEGER,
  status TEXT,
  attempts INTEGER DEFAULT 0,
  error TEXT,
  UNIQUE(job_id, chapter_idx, paragraph_idx)
);
