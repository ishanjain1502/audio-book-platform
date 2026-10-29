"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import type {
  AnnotationMessage,
  AnnotationSection,
  AnnotationView,
} from "@/lib/jobs/readAnnotation";

export default function AnnotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [currentSection, setCurrentSection] = useState<number | null>(null);
  const [characters, setCharacters] = useState<
    AnnotationView["characters"]
  >([]);
  const [sections, setSections] = useState<AnnotationSection[]>([]);
  const [book, setBook] = useState<AnnotationView["book"] | null>(null);
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void params.then((value) => setId(value.id));
  }, [params]);

  const applyView = useCallback((view: AnnotationView) => {
    setStatus(view.status);
    setJobError(view.error);
    setCurrentSection(view.currentSection);
    setCharacters(view.characters);
    setSections(view.sections);
    setBook(view.book);
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/jobs/${id}/annotation`);
      if (!active) return;
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Could not load annotation");
        setLoadedId(id);
        return;
      }
      applyView((await res.json()) as AnnotationView);
      setLoadedId(id);
    };
    void load();
    return () => {
      active = false;
    };
  }, [id, applyView]);

  useEffect(() => {
    if (!id || loadedId !== id || status !== "annotating") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/jobs/${id}/annotation`);
      if (!res.ok) return;
      applyView((await res.json()) as AnnotationView);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, loadedId, status, applyView]);

  function toggleOpened(sectionN: number) {
    setOpened((prev) => ({ ...prev, [sectionN]: !prev[sectionN] }));
  }

  async function setReviewed(section: AnnotationSection, reviewed: boolean) {
    if (!id) return;
    setError(null);
    const res = await fetch(`/api/jobs/${id}/annotation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterIdx: section.n - 1, reviewed }),
    });
    const body = (await res.json()) as { error?: string; reviewed?: boolean };
    if (!res.ok) {
      setError(body.error ?? "Could not update section");
      return;
    }
    setSections((prev) =>
      prev.map((s) =>
        s.n === section.n
          ? { ...s, reviewed: body.reviewed ?? reviewed }
          : s,
      ),
    );
    setOpened((prev) => ({ ...prev, [section.n]: reviewed ? false : true }));
  }

  async function changeSpeaker(
    section: AnnotationSection,
    message: AnnotationMessage,
    speakerIndex: number,
  ) {
    if (!id) return;
    setError(null);
    const res = await fetch(`/api/jobs/${id}/annotation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterIdx: section.n - 1,
        paragraphIdx: message.paragraphIdx,
        turnIdx: message.turnIdx,
        speakerIndex,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      speakerIndex?: number;
      speakerName?: string;
    };
    if (!res.ok) {
      setError(body.error ?? "Could not update speaker");
      return;
    }
    setSections((prev) =>
      prev.map((s) => {
        if (s.n !== section.n) return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.paragraphIdx === message.paragraphIdx &&
            m.turnIdx === message.turnIdx
              ? {
                  ...m,
                  speakerIndex: body.speakerIndex ?? speakerIndex,
                  speakerName: body.speakerName ?? m.speakerName,
                }
              : m,
          ),
        };
      }),
    );
  }

  async function retryAnnotation() {
    if (!id || !book) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/jobs/${id}/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: book.title,
        author: book.author,
        pageCount: book.pageCount ?? 0,
      }),
    });
    const body = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not start annotation");
      return;
    }
    const refresh = await fetch(`/api/jobs/${id}/annotation`);
    if (refresh.ok) applyView((await refresh.json()) as AnnotationView);
  }

  async function confirm() {
    if (!id || !book) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/jobs/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: book.title,
        author: book.author,
        pageCount: book.pageCount ?? 0,
      }),
    });
    const body = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not confirm");
      return;
    }
    router.push(`/jobs/${id}`);
  }

  const canConfirm =
    status === "awaiting_annotation" &&
    sections.every((section) => section.reviewed) &&
    !saving;

  if (!id) return null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">
        Review annotation
      </h1>

      {loadedId !== id ? (
        <GlassCard>
          <p className="text-center text-sm text-ink-muted">Loading…</p>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {status === "failed" ? (
            <GlassCard>
              <div className="space-y-3">
                <p className="text-sm text-semantic-error">
                  {jobError ?? "Annotation failed"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving || !book}
                  onClick={() => void retryAnnotation()}
                >
                  Retry annotation
                </Button>
              </div>
            </GlassCard>
          ) : null}

          {sections.map((section) => {
            const headerBase = `Section ${section.n}`;
            const headerText =
              section.title === headerBase
                ? headerBase
                : `${headerBase} · ${section.title}`;
            const collapsed = section.reviewed && !opened[section.n];

            return (
              <GlassCard key={section.n}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={section.reviewed}
                    className="mt-1 h-4 w-4 rounded border-border accent-accent"
                    onChange={(event) =>
                      void setReviewed(section, event.target.checked)
                    }
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Mark ${headerBase} reviewed`}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => toggleOpened(section.n)}
                  >
                    <span className="font-medium text-ink-primary">
                      {headerText}
                    </span>
                  </button>
                </div>

                {!collapsed ? (
                  <ul className="mt-4 space-y-4">
                    {section.messages.map((message) => (
                      <li
                        key={`${message.paragraphIdx}-${message.turnIdx}`}
                        className="space-y-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink-primary">
                            {message.speakerName}
                          </span>
                          <select
                            value={message.speakerIndex}
                            className="surface-input min-h-9 max-w-xs rounded-xl px-3 py-1.5 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                            onChange={(event) =>
                              void changeSpeaker(
                                section,
                                message,
                                Number(event.target.value),
                              )
                            }
                          >
                            {characters.map((character) => (
                              <option
                                key={character.speakerIndex}
                                value={character.speakerIndex}
                              >
                                {character.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="text-ink-primary">{message.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </GlassCard>
            );
          })}

          {typeof currentSection === "number" ? (
            <p className="text-sm text-ink-muted">
              Annotating section {currentSection}
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-semantic-error">{error}</p>
          ) : null}

          <Button type="button" disabled={!canConfirm} onClick={() => void confirm()}>
            {saving ? "Starting…" : "Confirm and generate audiobook"}
          </Button>
        </div>
      )}
    </main>
  );
}
