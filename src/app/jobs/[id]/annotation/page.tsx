"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnnotationLine } from "@/components/annotation/AnnotationLine";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  addLine,
  changeSpeaker,
  deleteLine,
  replaceParagraphMessages,
  retainOpenParagraph,
  splitLine,
  withDraft,
} from "@/lib/annotate/editLines";
import type { AnnotationTurn } from "@/lib/annotate/turns";
import type {
  AnnotationMessage,
  AnnotationSection,
  AnnotationView,
} from "@/lib/jobs/readAnnotation";

type OpenLine = {
  sectionN: number;
  paragraphIdx: number;
  turnIdx: number;
  draft: string;
};

type SavedParagraph = {
  paragraphIdx: number;
  turns: {
    turnIdx: number;
    speakerIndex: number;
    speakerName: string;
    text: string;
  }[];
};

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
  const [characters, setCharacters] = useState<AnnotationView["characters"]>([]);
  const [sections, setSections] = useState<AnnotationSection[]>([]);
  const [book, setBook] = useState<AnnotationView["book"] | null>(null);
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<OpenLine | null>(null);
  const openRef = useRef<{ sectionN: number; paragraphIdx: number } | null>(null);
  const persistInFlight = useRef<Promise<SavedParagraph | null> | null>(null);
  const writeGen = useRef(0);
  openRef.current = editing
    ? { sectionN: editing.sectionN, paragraphIdx: editing.paragraphIdx }
    : null;

  useEffect(() => {
    void params.then((value) => setId(value.id));
  }, [params]);

  const applyView = useCallback((view: AnnotationView) => {
    setStatus(view.status);
    setJobError(view.error);
    setCurrentSection(view.currentSection);
    setCharacters(view.characters);
    setBook(view.book);
    setSections((prev) => {
      const open = openRef.current;
      if (!open) return view.sections;
      return view.sections.map((section) => {
        if (section.n !== open.sectionN) return section;
        const previous = prev.find((item) => item.n === section.n);
        if (!previous) return section;
        return {
          ...section,
          messages: retainOpenParagraph(
            previous.messages,
            section.messages,
            open.paragraphIdx,
          ),
        };
      });
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const seen = writeGen.current;
    setEditing(null);
    const load = async () => {
      const res = await fetch(`/api/jobs/${id}/annotation`);
      if (!active || writeGen.current !== seen) return;
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
      const seen = writeGen.current;
      const res = await fetch(`/api/jobs/${id}/annotation`);
      if (!res.ok || writeGen.current !== seen) return;
      applyView((await res.json()) as AnnotationView);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, loadedId, status, applyView]);

  function toggleOpened(sectionN: number) {
    setOpened((prev) => ({ ...prev, [sectionN]: !prev[sectionN] }));
  }

  function savedLines(section: AnnotationSection, paragraphIdx: number): AnnotationTurn[] {
    return section.messages
      .filter((message) => message.paragraphIdx === paragraphIdx)
      .sort((a, b) => a.turnIdx - b.turnIdx)
      .map((message) => ({ speakerIndex: message.speakerIndex, text: message.text }));
  }

  function linesFor(section: AnnotationSection, paragraphIdx: number): AnnotationTurn[] {
    const open =
      editing &&
      editing.sectionN === section.n &&
      editing.paragraphIdx === paragraphIdx
        ? editing
        : null;
    return withDraft(savedLines(section, paragraphIdx), open?.turnIdx ?? 0, open ? open.draft : null);
  }

  function showSaved(sectionN: number, saved: SavedParagraph) {
    setSections((prev) =>
      prev.map((section) => {
        if (section.n !== sectionN) return section;
        return {
          ...section,
          messages: replaceParagraphMessages(
            section.messages,
            saved.paragraphIdx,
            saved.turns.map((turn) => ({
              paragraphIdx: saved.paragraphIdx,
              turnIdx: turn.turnIdx,
              speakerIndex: turn.speakerIndex,
              speakerName: turn.speakerName,
              text: turn.text,
            })),
          ),
        };
      }),
    );
  }

  async function persist(
    section: AnnotationSection,
    paragraphIdx: number,
    turns: AnnotationTurn[],
  ): Promise<SavedParagraph | null> {
    if (!id) return null;
    const promise = (async () => {
      setWriting(true);
      setError(null);
      try {
        const res = await fetch(`/api/jobs/${id}/annotation`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapterIdx: section.n - 1,
            paragraphIdx,
            turns,
          }),
        });
        const body = (await res.json()) as {
          error?: string;
          paragraphIdx?: number;
          turns?: SavedParagraph["turns"];
        };
        if (!res.ok || body.paragraphIdx == null || !body.turns) {
          setError(body.error ?? "Could not update line");
          return null;
        }
        const saved = { paragraphIdx: body.paragraphIdx, turns: body.turns };
        writeGen.current += 1;
        showSaved(section.n, saved);
        return saved;
      } finally {
        setWriting(false);
      }
    })();
    persistInFlight.current = promise;
    try {
      return await promise;
    } finally {
      if (persistInFlight.current === promise) {
        persistInFlight.current = null;
      }
    }
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
      prev.map((item) =>
        item.n === section.n ? { ...item, reviewed: body.reviewed ?? reviewed } : item,
      ),
    );
    setOpened((prev) => ({ ...prev, [section.n]: reviewed ? false : true }));
  }

  async function saveOpen(section: AnnotationSection, message: AnnotationMessage) {
    if (
      !editing ||
      editing.sectionN !== section.n ||
      editing.paragraphIdx !== message.paragraphIdx ||
      editing.turnIdx !== message.turnIdx
    ) {
      return;
    }
    if (editing.draft === message.text) {
      setEditing(null);
      return;
    }
    const saved = await persist(
      section,
      message.paragraphIdx,
      withDraft(savedLines(section, message.paragraphIdx), message.turnIdx, editing.draft),
    );
    if (!saved) return;
    setEditing(null);
  }

  async function onAdd(section: AnnotationSection, message: AnnotationMessage) {
    const saved = await persist(
      section,
      message.paragraphIdx,
      addLine(linesFor(section, message.paragraphIdx), message.turnIdx),
    );
    if (!saved) return;
    const created = saved.turns[message.turnIdx + 1];
    setEditing({
      sectionN: section.n,
      paragraphIdx: saved.paragraphIdx,
      turnIdx: created.turnIdx,
      draft: created.text,
    });
  }

  async function onSplit(
    section: AnnotationSection,
    message: AnnotationMessage,
    cursor: number,
  ) {
    const saved = await persist(
      section,
      message.paragraphIdx,
      splitLine(linesFor(section, message.paragraphIdx), message.turnIdx, cursor),
    );
    if (!saved) return;
    setEditing(null);
  }

  async function onDelete(section: AnnotationSection, message: AnnotationMessage) {
    const turns = deleteLine(linesFor(section, message.paragraphIdx), message.turnIdx);
    if (!turns) return;
    const saved = await persist(section, message.paragraphIdx, turns);
    if (!saved) return;
    setEditing(null);
  }

  async function onSpeaker(
    section: AnnotationSection,
    message: AnnotationMessage,
    speakerIndex: number,
  ) {
    const saved = await persist(
      section,
      message.paragraphIdx,
      changeSpeaker(linesFor(section, message.paragraphIdx), message.turnIdx, speakerIndex),
    );
    if (!saved) return;
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
    const pending = persistInFlight.current;
    if (pending) {
      const saved = await pending;
      if (!saved) return;
    }
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

  function displayedLineText(
    section: AnnotationSection,
    message: AnnotationMessage,
  ): string {
    if (
      editing &&
      editing.sectionN === section.n &&
      editing.paragraphIdx === message.paragraphIdx &&
      editing.turnIdx === message.turnIdx
    ) {
      return editing.draft;
    }
    return message.text;
  }

  const linesHaveText = sections.every((section) =>
    section.messages.every(
      (message) => displayedLineText(section, message).trim().length > 0,
    ),
  );
  const canConfirm =
    status === "awaiting_annotation" &&
    sections.length > 0 &&
    sections.every((section) => section.reviewed) &&
    linesHaveText &&
    !saving &&
    !writing;

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
                    <span className="font-medium text-ink-primary">{headerText}</span>
                  </button>
                </div>

                {!collapsed ? (
                  <ul className="mt-4 space-y-4">
                    {section.messages.map((message) => {
                      const open =
                        editing?.sectionN === section.n &&
                        editing.paragraphIdx === message.paragraphIdx &&
                        editing.turnIdx === message.turnIdx;
                      return (
                        <AnnotationLine
                          key={`${message.paragraphIdx}-${message.turnIdx}`}
                          message={message}
                          characters={characters}
                          paragraphLineCount={
                            section.messages.filter(
                              (item) => item.paragraphIdx === message.paragraphIdx,
                            ).length
                          }
                          editing={open}
                          draft={open ? editing.draft : message.text}
                          writing={writing}
                          onDraft={(value) =>
                            setEditing((current) =>
                              current &&
                              current.sectionN === section.n &&
                              current.paragraphIdx === message.paragraphIdx &&
                              current.turnIdx === message.turnIdx
                                ? { ...current, draft: value }
                                : current,
                            )
                          }
                          onOpen={() =>
                            setEditing({
                              sectionN: section.n,
                              paragraphIdx: message.paragraphIdx,
                              turnIdx: message.turnIdx,
                              draft: message.text,
                            })
                          }
                          onBlur={() => void saveOpen(section, message)}
                          onSpeaker={(speakerIndex) =>
                            void onSpeaker(section, message, speakerIndex)
                          }
                          onAdd={() => void onAdd(section, message)}
                          onSplit={(cursor) => void onSplit(section, message, cursor)}
                          onDelete={() => void onDelete(section, message)}
                        />
                      );
                    })}
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

          {error ? <p className="text-sm text-semantic-error">{error}</p> : null}

          <Button type="button" disabled={!canConfirm} onClick={() => void confirm()}>
            {saving ? "Starting…" : "Confirm and generate audiobook"}
          </Button>
        </div>
      )}
    </main>
  );
}
