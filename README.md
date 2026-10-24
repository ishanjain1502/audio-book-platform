# Audiobook Generator

PDF → expressive multi-chapter MP3 via Commandcode (DeepSeek) + Fish Audio Drama 3.

## Setup

1. Copy `.env.example` to `.env` and set `COMMANDCODE_API_KEY` and `FISH_API_KEY`.
2. `npm install` and `npm approve-scripts better-sqlite3` if needed.
3. `npm run dev` — open http://localhost:3000

## Scripts

- `npm test` — unit tests
- `npm run build` — production build

See `.docs/build-plan.md` for architecture and pipeline details.
