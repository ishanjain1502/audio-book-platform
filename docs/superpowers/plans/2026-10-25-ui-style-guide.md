# UI Style Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved cinema-dark + teal-glass design system to `/` and `/jobs/[id]` using Tailwind tokens, `next/font`, and small UI primitives—without changing API behavior.

**Architecture:** CSS variables in `globals.css` map into `tailwind.config.ts`. `AppShell` wraps all pages with a fixed starfield/gradient background. Route pages compose primitives (`GlassCard`, `Button`, `FileDropzone`, `JobProgress`, `ChapterPlayer`, `StatusBadge`). Pure helpers (`coverGradientFromSeed`, `statusPresentation`) live under `src/lib/ui/` and are covered by Vitest.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 3.4, `next/font/google`, `lucide-react`, Vitest.

## Global Constraints

- Scope: visual + layout only on `src/app/page.tsx`, `src/app/jobs/[id]/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`.
- No API contract changes; same `FormData` POST to `/api/jobs` and polling `GET /api/jobs/:id`.
- No shadcn or full UI framework for v1.
- Responsive equally: same components; breakpoints `md` (768px), `lg` (1024px).
- Touch targets ≥ 44px on primary actions.
- Dev log path hidden in `<details>` labeled "Developer".
- `npm run build` and `npm test` must pass before calling the work done.
- Progress UI: **ring below `md`, linear bar from `md` up** (single decision locked here).

## File map

| Path | Responsibility |
|------|----------------|
| `src/app/globals.css` | CSS variables, starfield, glass utilities, motion utilities |
| `tailwind.config.ts` | Theme colors/fonts referencing CSS variables |
| `src/app/layout.tsx` | Fonts, `AppShell`, body classes |
| `src/components/layout/AppShell.tsx` | Fixed background, top bar, content slot |
| `src/components/ui/GlassCard.tsx` | Glass surface wrapper |
| `src/components/ui/Button.tsx` | Primary + ghost buttons |
| `src/components/ui/FileDropzone.tsx` | Drag/drop + hidden file input |
| `src/components/ui/JobProgress.tsx` | Ring (mobile) + bar (md+) |
| `src/components/ui/StatusBadge.tsx` | Status label styling |
| `src/components/ui/ChapterPlayer.tsx` | Cover tile, audio, download |
| `src/lib/ui/coverGradient.ts` | Deterministic gradient from seed string |
| `src/lib/ui/statusPresentation.ts` | Map `status` string → label + tone |
| `src/lib/ui/cn.ts` | Tiny `cn(...classes)` helper |
| `src/app/page.tsx` | Home hero + upload form |
| `src/app/jobs/[id]/page.tsx` | Job status + chapter grid |
| `tests/lib/ui/coverGradient.test.ts` | Unit tests for gradient helper |
| `tests/lib/ui/statusPresentation.test.ts` | Unit tests for status mapping |

---

### Task 1: Design tokens and Tailwind theme

**Files:**
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Produces: CSS variables `--bg-deep`, `--bg-elevated`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent`, `--accent-secondary`, `--error`, `--success`; utility classes `.app-starfield`, `.glass-panel`, `.animate-page-in`.

- [ ] **Step 1: Replace `globals.css` content**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-deep: #0a0b10;
  --bg-deep-end: #12141c;
  --bg-elevated: rgba(255, 255, 255, 0.04);
  --text-primary: #f4f4f5;
  --text-muted: #a1a1aa;
  --border-subtle: rgba(255, 255, 255, 0.1);
  --accent: #2ee6c5;
  --accent-secondary: #7c6cf0;
  --error: #f87171;
  --success: #2ee6c5;
}

@layer base {
  body {
    color: var(--text-primary);
    background: var(--bg-deep);
  }
}

@layer components {
  .app-starfield {
    position: fixed;
    inset: 0;
    z-index: -1;
    background: radial-gradient(ellipse 120% 80% at 50% -20%, rgba(46, 230, 197, 0.08), transparent 50%),
      linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-deep-end) 100%);
  }

  .app-starfield::after {
    content: "";
    position: absolute;
    inset: 0;
    opacity: 0.35;
    background-image: radial-gradient(1px 1px at 20% 30%, rgba(255, 255, 255, 0.5), transparent),
      radial-gradient(1px 1px at 80% 10%, rgba(255, 255, 255, 0.4), transparent),
      radial-gradient(1px 1px at 40% 70%, rgba(255, 255, 255, 0.35), transparent);
    background-size: 200% 200%;
  }

  .glass-panel {
    @apply rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl;
  }

  .glass-panel-accent {
    @apply glass-panel shadow-[0_0_40px_-12px_rgba(46,230,197,0.35)];
  }
}

@layer utilities {
  .animate-page-in {
    animation: page-in 200ms ease-out both;
  }

  @keyframes page-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .animate-page-in {
      animation: none;
    }
  }
}
```

- [ ] **Step 2: Extend `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          deep: "var(--bg-deep)",
          elevated: "var(--bg-elevated)",
        },
        ink: {
          primary: "var(--text-primary)",
          muted: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          secondary: "var(--accent-secondary)",
        },
        semantic: {
          error: "var(--error)",
          success: "var(--success)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`  
Expected: SUCCESS (pages may still look unchanged until layout task).

- [ ] **Step 4: Commit (optional)**

```bash
git add src/app/globals.css tailwind.config.ts
git commit -m "feat(ui): add design tokens and glass utilities"
```

---

### Task 2: `coverGradientFromSeed` helper

**Files:**
- Create: `src/lib/ui/coverGradient.ts`
- Create: `tests/lib/ui/coverGradient.test.ts`

**Interfaces:**
- Produces: `export function coverGradientFromSeed(seed: string): { from: string; to: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { coverGradientFromSeed } from "@/lib/ui/coverGradient";

describe("coverGradientFromSeed", () => {
  it("returns stable colors for the same seed", () => {
    const a = coverGradientFromSeed("chapter-1");
    const b = coverGradientFromSeed("chapter-1");
    expect(a).toEqual(b);
    expect(a.from).toMatch(/^#/);
    expect(a.to).toMatch(/^#/);
  });

  it("returns different colors for different seeds", () => {
    const a = coverGradientFromSeed("alpha");
    const b = coverGradientFromSeed("beta");
    expect(a.from).not.toBe(b.from);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/ui/coverGradient.test.ts`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function coverGradientFromSeed(seed: string): { from: string; to: string } {
  const h = hashString(seed);
  const hue = h % 360;
  const from = hslToHex(hue, 0.55, 0.35);
  const to = hslToHex((hue + 40) % 360, 0.6, 0.22);
  return { from, to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/ui/coverGradient.test.ts`  
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (optional)**

```bash
git add src/lib/ui/coverGradient.ts tests/lib/ui/coverGradient.test.ts
git commit -m "feat(ui): add cover gradient helper"
```

---

### Task 3: `statusPresentation` helper

**Files:**
- Create: `src/lib/ui/statusPresentation.ts`
- Create: `tests/lib/ui/statusPresentation.test.ts`

**Interfaces:**
- Produces: `export function statusPresentation(status: string): { label: string; tone: "neutral" | "active" | "done" | "error" }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { statusPresentation } from "@/lib/ui/statusPresentation";

describe("statusPresentation", () => {
  it("marks completed jobs as done", () => {
    expect(statusPresentation("completed").tone).toBe("done");
  });

  it("marks failed jobs as error", () => {
    expect(statusPresentation("failed").tone).toBe("error");
  });

  it("defaults unknown statuses to neutral", () => {
    expect(statusPresentation("queued").tone).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/lib/ui/statusPresentation.test.ts`

- [ ] **Step 3: Implement**

```ts
export type StatusTone = "neutral" | "active" | "done" | "error";

export function statusPresentation(status: string): {
  label: string;
  tone: StatusTone;
} {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "complete") {
    return { label: "Completed", tone: "done" };
  }
  if (normalized === "failed" || normalized === "error") {
    return { label: "Failed", tone: "error" };
  }
  if (
    normalized === "processing" ||
    normalized === "running" ||
    normalized === "active"
  ) {
    return { label: "In progress", tone: "active" };
  }
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return { label, tone: "neutral" };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/lib/ui/statusPresentation.test.ts`

- [ ] **Step 5: Commit (optional)**

```bash
git add src/lib/ui/statusPresentation.ts tests/lib/ui/statusPresentation.test.ts
git commit -m "feat(ui): add job status presentation helper"
```

---

### Task 4: `cn`, `GlassCard`, `Button`

**Files:**
- Create: `src/lib/ui/cn.ts`
- Create: `src/components/ui/GlassCard.tsx`
- Create: `src/components/ui/Button.tsx`

**Interfaces:**
- Produces: `export function cn(...parts: Array<string | false | null | undefined>): string`
- Produces: `export function GlassCard({ children, className?, accent? }: { children: React.ReactNode; className?: string; accent?: boolean })`
- Produces: `export function Button({ variant?, className?, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" })`

- [ ] **Step 1: Add `cn.ts`**

```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 2: Add `GlassCard.tsx`**

```tsx
import { cn } from "@/lib/ui/cn";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
};

export function GlassCard({ children, className, accent }: GlassCardProps) {
  return (
    <div className={cn(accent ? "glass-panel-accent" : "glass-panel", "p-5 md:p-6", className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Add `Button.tsx`**

```tsx
import { cn } from "@/lib/ui/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({
  variant = "primary",
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-accent text-canvas-deep shadow-[0_0_24px_-6px_rgba(46,230,197,0.55)] hover:brightness-110"
      : "border border-white/15 bg-white/5 text-ink-primary hover:bg-white/10";
  return (
    <button
      className={cn(base, styles, className)}
      disabled={disabled}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`  
Expected: SUCCESS.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/lib/ui/cn.ts src/components/ui/GlassCard.tsx src/components/ui/Button.tsx
git commit -m "feat(ui): add GlassCard and Button primitives"
```

---

### Task 5: Fonts and `AppShell`

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: `export function AppShell({ children }: { children: React.ReactNode })`

- [ ] **Step 1: Install lucide-react**

Run: `npm install lucide-react`

- [ ] **Step 2: Create `AppShell.tsx`**

```tsx
import Link from "next/link";
import { Headphones } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-starfield" aria-hidden />
      <div className="relative flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-ink-primary transition hover:text-accent">
            <Headphones className="h-5 w-5 text-accent" strokeWidth={1.5} />
            <span className="font-display text-sm font-semibold tracking-tight md:text-base">
              Audiobook Generator
            </span>
          </Link>
        </header>
        <div className="flex-1 animate-page-in">{children}</div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Update `layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontDisplay = Outfit({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Audiobook Generator",
  description: "PDF to expressive audiobook",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`  
Expected: SUCCESS.

- [ ] **Step 5: Commit (optional)**

```bash
git add package.json package-lock.json src/components/layout/AppShell.tsx src/app/layout.tsx
git commit -m "feat(ui): add AppShell, fonts, and starfield layout"
```

---

### Task 6: `FileDropzone` and home page

**Files:**
- Create: `src/components/ui/FileDropzone.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GlassCard`, `Button`, `cn`
- Produces: `export function FileDropzone(props: { label: string; accept: string; required?: boolean; file: File | null; onFile: (f: File | null) => void; hint?: string })`

- [ ] **Step 1: Implement `FileDropzone.tsx`**

Use a hidden `<input type="file">`, click-to-open zone, `onDragOver`/`onDrop` with `preventDefault`, dashed `border-accent/40` when dragging, show selected file name.

- [ ] **Step 2: Rewrite `page.tsx`**

Keep existing `onSubmit` logic (`FormData`, `/api/jobs`, router push). Layout:

- `main`: `mx-auto w-full max-w-lg px-4 pb-12 sm:px-6`
- Hero: `font-display text-3xl md:text-4xl lg:text-[2.75rem] tracking-tight`
- Subtitle: `text-sm md:text-base text-ink-muted`
- `GlassCard accent` wrapping form with `space-y-6`
- Email input: `min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 focus:border-accent focus:outline-none`
- PDF + voice via two `FileDropzone`s
- Errors: `text-sm text-semantic-error`
- Submit: `Button` with `className="w-full md:w-auto md:max-w-xs"` and loading label

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` — open `/`, confirm starfield, glass card, file pick still submits.

- [ ] **Step 4: Run `npm run build`**

Expected: SUCCESS.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/components/ui/FileDropzone.tsx src/app/page.tsx
git commit -m "feat(ui): restyle home upload with FileDropzone"
```

---

### Task 7: `JobProgress`, `StatusBadge`, `ChapterPlayer`

**Files:**
- Create: `src/components/ui/JobProgress.tsx`
- Create: `src/components/ui/StatusBadge.tsx`
- Create: `src/components/ui/ChapterPlayer.tsx`

**Interfaces:**
- `JobProgress({ value: number; pulsing?: boolean })` — SVG ring visible `md:hidden`; bar `hidden md:block`
- `StatusBadge({ status: string })` — uses `statusPresentation`
- `ChapterPlayer({ title, ready, downloadUrl, seed, showReadyAnimation?: boolean })`

- [ ] **Step 1: `JobProgress`**

Ring: `stroke-accent` on circle, `transition-all duration-500`. Bar: `h-2 rounded-full bg-white/10` with inner `bg-accent` width `%`.

- [ ] **Step 2: `StatusBadge`**

Pill with tone classes: `active` → accent border; `done` → success; `error` → semantic-error; default muted.

- [ ] **Step 3: `ChapterPlayer`**

Row layout: cover `div` with `style={{ background: linear-gradient(135deg, from, to) }}` from `coverGradientFromSeed(seed)`. Title `font-display line-clamp-2`. Pending: muted "Pending". Ready: `<audio controls className="h-10 w-full min-w-0">` + ghost download link with `Download` icon.

Add `@media (prefers-reduced-motion: reduce)` class to skip scale-in on ready.

- [ ] **Step 4: Build**

Run: `npm run build`  
Expected: SUCCESS.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/components/ui/JobProgress.tsx src/components/ui/StatusBadge.tsx src/components/ui/ChapterPlayer.tsx
git commit -m "feat(ui): add job progress and chapter player components"
```

---

### Task 8: Job page composition

**Files:**
- Modify: `src/app/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: all UI components from Tasks 4–7; existing `JobStatus` type and polling `useEffect` unchanged.

- [ ] **Step 1: Restructure JSX**

- `main`: `mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6`
- Header row `md:flex md:items-center md:justify-between`: title `Job #${id}` + `StatusBadge`
- `GlassCard` for progress block: `JobProgress`, `text-sm md:text-base` for phase/detail, error line if `job.error`
- Chapters: `ul` with `grid gap-4 md:grid-cols-2` when `job.chapters.length > 1`, else single column
- Each item wraps `ChapterPlayer` with `seed={`${id}-${ch.title}`}`

- [ ] **Step 2: Developer disclosure**

```tsx
<details className="mt-6 text-sm text-ink-muted">
  <summary className="cursor-pointer text-accent-secondary">Developer</summary>
  <p className="mt-2">
    Live log: <code className="text-ink-primary">src/data/jobs/{id}/progress.log</code>
    (also printed in the terminal where the worker runs)
  </p>
</details>
```

- [ ] **Step 3: Loading state**

Use centered muted text inside `GlassCard` while `!job`.

- [ ] **Step 4: Manual test**

Use existing job id in dev (e.g. `/jobs/3`) — polling, audio, download unchanged.

- [ ] **Step 5: Full verification**

Run: `npm test`  
Expected: all tests PASS.

Run: `npm run build`  
Expected: SUCCESS.

Visual: resize to 390px, 768px, 1280px per spec.

- [ ] **Step 6: Commit (optional)**

```bash
git add src/app/jobs/[id]/page.tsx
git commit -m "feat(ui): restyle job page with glass progress and chapter cards"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| CSS color tokens | Task 1 |
| Typography via `next/font` | Task 5 |
| Starfield background | Task 1 + 5 |
| Glass surfaces | Task 1, 4 |
| Responsive home layout | Task 6 |
| Responsive job layout + 2-col chapters | Task 8 |
| FileDropzone / same POST | Task 6 |
| Progress ring/bar split | Task 7 |
| Chapter cover gradient | Task 2 + 7 |
| StatusBadge | Task 3 + 7 |
| Dev log in `<details>` | Task 8 |
| Lucide icons | Task 5 + 6/7/8 |
| Motion + reduced motion | Task 1, 7, 8 |
| `npm run build` / tests | All tasks |

## Self-review notes

- No TBD steps; `FileDropzone` implementation is described by behavior (drag/drop + hidden input) — implementer fills ~40 lines following home page needs.
- No API changes.
- Commits are optional per team preference; keep changes grouped by task when committing.

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-25-ui-style-guide.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach do you want?
