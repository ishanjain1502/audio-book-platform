# UI style guide & frontend refresh — design spec

**Status:** Approved (conversation 2026-10-25)  
**Inspiration:** [Audiobooks Mobile App (Dribbble)](https://dribbble.com/shots/20360188-Audiobooks-Mobile-App)  
**Scope:** Visual system + layout for existing routes only (`/` upload, `/jobs/[id]` status/player). No new product features.

## Goals

- Make the app feel like an **immersive listening product**, not an internal tool.
- Keep **upload and progress honest** — wait states and errors stay clear.
- **One component set** with responsive behavior at `md` (768px) and `lg` (1024px).
- Avoid a heavy UI framework for v1; use Tailwind + CSS variables + small primitives.

## Non-goals (v1)

- User accounts, library/history, or mobile app shell.
- Custom audio engine (styled native `<audio>` is acceptable).
- 3D marketing props from the Dribbble presentation frame.
- Replacing backend or job APIs.

---

## Personality

| Principle | Application |
|-----------|-------------|
| Immersive, not corporate | Dark canvas, cover-forward chapter cards, listening-first job page |
| Playful via light & depth | Teal glow, glass surfaces, subtle motion — not mascots or loud illustration |
| Generator honesty | Phase, progress %, and errors visible; dev log behind disclosure |

---

## Color system

Define in `globals.css` as CSS variables; extend `tailwind.config` to map them.

### Base (dark canvas)

| Token | Value | Usage |
|-------|--------|--------|
| `--bg-deep` | `#0a0b10` → `#12141c` gradient | Page shell |
| `--bg-elevated` | `rgba(255,255,255,0.04)` | Card fill under glass |
| `--text-primary` | `#f4f4f5` | Headings, body |
| `--text-muted` | `#a1a1aa` (use at ~70% opacity where needed) | Hints, secondary labels |
| `--border-subtle` | `rgba(255,255,255,0.10)` | Default card borders |

### Accent (Dribbble teal family)

| Token | Value | Usage |
|-------|--------|--------|
| `--accent` | `#2ee6c5` | Primary CTA, progress, focus rings, active icons |
| `--accent-glow` | `#2ee6c5` at 20–40% opacity | `box-shadow`, gradient borders |
| `--accent-secondary` | `#7c6cf0` (optional) | Secondary links/chips sparingly |

### Semantic

| Token | Value | Usage |
|-------|--------|--------|
| `--error` | `#f87171` | Form and job errors |
| `--success` | Align with accent green family | Chapter ready state |

### Background treatment

- Fixed **starfield or soft noise gradient** on the app shell (all pages).
- Job page may use a **placeholder “cover” gradient** derived from job id or title hash until real artwork exists.

---

## Typography

Load via `next/font`:

| Role | Font (recommended) | Usage |
|------|-------------------|--------|
| Display | Outfit or Satoshi | App title, chapter titles |
| UI / body | Inter or DM Sans | Forms, status, metadata |

### Responsive scale

- Display (home hero): `text-3xl` → `md:text-4xl` → `lg:text-[2.75rem]`, `tracking-tight`
- Job page title: `text-xl` → `md:text-2xl`
- Body: `text-sm` → `md:text-base` for longer status copy
- Metadata: `text-sm` muted

---

## Shape, space, and glass

- **Radius:** `rounded-2xl` cards; `rounded-full` pills (buttons, icon chrome).
- **Borders:** 1px `--border-subtle`; focus/active → `--accent` + soft outer glow.
- **Glass pattern:** `backdrop-blur-xl` + `bg-white/5` + `border border-white/10`; optional gradient border (teal → transparent) on primary upload card and “now playing” emphasis.
- **Spacing:** `space-y-6` on forms; container `px-4 sm:px-6`; max width `max-w-lg` (home), `max-w-3xl` (job) at `md+`.
- **Touch:** Minimum 44px height on primary buttons and chapter actions.

---

## Responsive layout (option C — equal priority)

Breakpoints: Tailwind `md` (768px), `lg` (1024px).

### Shell

- Full-viewport background (fixed); scrollable content above.
- `mx-auto w-full` with route-specific max widths.

### Home `/`

| Viewport | Layout |
|----------|--------|
| &lt; md | Single column; full-width glass upload card; full-width primary CTA |
| md+ | Centered card; email + optional voice row may sit in two columns; CTA `w-full md:w-auto` with `max-w-xs` |

### Job `/jobs/[id]`

| Viewport | Layout |
|----------|--------|
| &lt; md | Stacked header, progress (ring or bar), chapter cards; audio full width |
| md+ | Status + progress on one row; chapters as list; `md:grid md:grid-cols-2` when many chapters |
| lg | Same components; comfortable reading width within `max-w-3xl` |

### Dev / operator details

- Path to `progress.log` and terminal hint live inside `<details>` (“Developer”) on all breakpoints.

---

## Components (primitives)

Implement as focused files under e.g. `src/components/ui/`:

| Component | Responsibility |
|-----------|----------------|
| `AppShell` | Background, container, optional top bar (wordmark + link home) |
| `GlassCard` | Shared glass surface; `p-5 md:p-6` |
| `Button` | Primary (accent + glow hover), ghost, sizes; primary CTA `w-full md:w-auto` on home |
| `FileDropzone` | PDF + optional voice; dashed accent border, drag-over state |
| `Progress` | Job %; ring on small viewports, linear bar from `md` (single chosen pattern in implementation) |
| `ChapterPlayer` | Placeholder cover tile, title (`line-clamp-2`), `<audio>`, download link |
| `StatusBadge` | Maps `job.status` to label + subtle color |

### Chapter card layout

- Cover tile: `h-16 w-16` → `md:h-20 md:w-20`, rounded-xl, gradient from hash.
- Pending: muted label + optional pulse on parent job when processing.
- Ready: scale-in animation (respect `prefers-reduced-motion`).

---

## Motion

| Event | Behavior |
|-------|----------|
| Page enter | Fade + `translate-y-1`, ~200ms |
| Progress value | Smooth width/ring transition |
| Processing | Optional subtle pulse on progress indicator |
| Chapter ready | Short scale-in |
| Reduced motion | Disable nonessential animation |

---

## Iconography

- **Lucide React** (add dependency if not present): headphones, upload, book/chapter, download, sparkles (generating).
- Stroke 1.5; `accent` when active.

---

## Page-level changes (behavior preserved)

### Home

- Replace raw file inputs with `FileDropzone` where practical; keep same `FormData` POST to `/api/jobs`.
- Hero copy: short subtitle under display title.
- Errors use `--error` styling inside glass card.

### Job

- Replace plain list with `ChapterPlayer` cards.
- Progress + `phase` / `detail` prominently styled.
- Hide dev log behind `<details>`.

### Root layout

- Apply fonts, `AppShell` or equivalent wrapper, CSS variables on `body`.

---

## Testing & verification

- Manual: upload flow, redirect to job, poll UI, play audio, download link.
- Visual: spot-check at 390px, 768px, 1280px widths.
- `npm run build` must pass.
- No change to API contracts required for UI-only work.

---

## Implementation order (suggested)

1. Tokens + fonts + `AppShell` background in `layout.tsx` / `globals.css`
2. Primitives: `GlassCard`, `Button`
3. Home page composition + `FileDropzone`
4. Job page: `Progress`, `ChapterPlayer`, dev `<details>`
5. Motion polish + `prefers-reduced-motion`

---

## Decisions log

| Decision | Choice |
|----------|--------|
| Visual direction | Cinema dark + teal glass (Dribbble-inspired) |
| Layout strategy | C — responsive equally, same components |
| UI framework | None for v1; Tailwind + small components |
| Audio | Native controls, styled container |

---

## References

- Current pages: `src/app/page.tsx`, `src/app/jobs/[id]/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- Inspiration: https://dribbble.com/shots/20360188-Audiobooks-Mobile-App
