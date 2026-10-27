"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";

type CharacterSummary = { name: string; role: string; tonality: string[] };

type ReviewJob = {
  title: string | null;
  author: string | null;
  pageCount: number | null;
  researchStatus: "idle" | "running" | "ready" | "failed";
  researchMode: string | null;
  researchError: string | null;
  characters: CharacterSummary[];
};

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [researchStatus, setResearchStatus] = useState<ReviewJob["researchStatus"]>("idle");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [researchMode, setResearchMode] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void params.then((value) => setId(value.id));
  }, [params]);

  function apply(job: ReviewJob, fillFields: boolean) {
    if (fillFields) {
      setTitle(job.title ?? "");
      setAuthor(job.author ?? "");
      setPageCount(job.pageCount == null ? "" : String(job.pageCount));
    }
    setResearchStatus(job.researchStatus);
    setResearchMode(job.researchMode);
    setResearchError(job.researchError);
    setCharacters(job.characters);
  }

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async (fillFields: boolean) => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok || !active) return;
      apply((await res.json()) as ReviewJob, fillFields);
      if (!active) return;
      setLoadedId(id);
    };
    void load(true);
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id || loadedId !== id || researchStatus !== "idle") return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${id}/research`, { method: "POST" });
        if (!active) return;
        if (!res.ok) {
          setResearchStatus("failed");
          setResearchError("Research failed");
          return;
        }
        const body = (await res.json()) as {
          status: ReviewJob["researchStatus"];
          error?: string;
          characters?: CharacterSummary[];
          researchMode?: string | null;
        };
        if (!active) return;
        setResearchStatus(body.status);
        if (body.status === "failed") setResearchError(body.error ?? "Research failed");
        if (body.status === "ready") {
          setCharacters(body.characters ?? []);
          setResearchMode(body.researchMode ?? null);
          setResearchError(null);
        }
      } catch {
        if (!active) return;
        setResearchStatus("failed");
        setResearchError("Research failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [id, loadedId, researchStatus]);

  useEffect(() => {
    if (!id || researchStatus !== "running") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const job = (await res.json()) as ReviewJob;
      if (job.researchStatus === "running") return;
      apply(job, false);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, researchStatus]);

  async function saveMeta() {
    if (!id) return;
    setError(null);
    const res = await fetch(`/api/jobs/${id}/book`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        pageCount: Number(pageCount),
      }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) setError(body.error ?? "Could not save book details");
  }

  async function confirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/jobs/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        pageCount: Number(pageCount),
      }),
    });
    const body = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not start the audiobook");
      return;
    }
    router.push(`/jobs/${id}`);
  }

  const pageOk = Number.isInteger(Number(pageCount)) && Number(pageCount) >= 1;
  const canConfirm =
    researchStatus === "ready" && title.trim().length > 0 && pageOk && !saving;

  if (!id) return null;

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-12 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">
        Book details
      </h1>
      <GlassCard accent>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label className="block text-sm">
            <span className="text-ink-primary">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-primary">Author</span>
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-primary">Pages</span>
            <input
              inputMode="numeric"
              value={pageCount}
              onChange={(event) => setPageCount(event.target.value)}
              onBlur={() => void saveMeta()}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>

          {researchStatus === "running" || researchStatus === "idle" ? (
            <p className="text-sm text-ink-muted">Researching this book…</p>
          ) : null}
          {researchStatus === "failed" ? (
            <div className="space-y-3">
              <p className="text-sm text-semantic-error">
                {researchError ?? "Research failed"}
              </p>
              <Button type="button" variant="ghost" onClick={() => setResearchStatus("idle")}>
                Retry research
              </Button>
            </div>
          ) : null}
          {researchStatus === "ready" ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                {researchMode === "web_research" ? "Web research" : "From the book text"}
              </p>
              <ul className="space-y-2 text-sm text-ink-primary">
                {characters.map((character) => (
                  <li key={character.name}>
                    {character.name} · {character.role} · {character.tonality.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p className="text-sm text-semantic-error">{error}</p> : null}
          <Button type="submit" disabled={!canConfirm}>
            {saving ? "Starting…" : "Generate audiobook"}
          </Button>
        </form>
      </GlassCard>
    </main>
  );
}
