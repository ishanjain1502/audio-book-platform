"use client";

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { JobProgress } from "@/components/ui/JobProgress";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ChapterPlayer } from "@/components/ui/ChapterPlayer";

type JobStatus = {
  id: number;
  status: string;
  error: string | null;
  progress: number;
  phase: string | null;
  detail: string | null;
  chapters: { title: string; ready: boolean; downloadUrl: string }[];
};

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);

  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const tick = async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as JobStatus;
      if (active) setJob(data);
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [id]);

  if (!id) return null;

  const processing =
    job &&
    !["completed", "complete", "failed", "error"].includes(
      job.status.toLowerCase(),
    );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6">
      <div className="mb-6 md:flex md:items-center md:justify-between md:gap-4">
        <h1 className="font-display text-xl font-semibold tracking-tight md:text-2xl">
          Job #{id}
        </h1>
        {job && <StatusBadge status={job.status} />}
      </div>

      {!job ? (
        <GlassCard>
          <p className="text-center text-sm text-ink-muted md:text-base">
            Loading…
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          <GlassCard accent>
            <JobProgress value={job.progress} pulsing={!!processing} />
            {job.phase && (
              <p className="mt-4 text-sm text-ink-muted md:text-base">
                {job.phase}
                {job.detail ? ` — ${job.detail}` : ""}
              </p>
            )}
            {job.error && (
              <p className="mt-3 text-sm text-semantic-error">{job.error}</p>
            )}
          </GlassCard>

          <section>
            <h2 className="mb-3 font-display text-lg font-medium text-ink-primary">
              Chapters
            </h2>
            <ul
              className={
                job.chapters.length > 1
                  ? "grid list-none gap-4 md:grid-cols-2"
                  : "grid list-none gap-4"
              }
            >
              {job.chapters.map((ch) => (
                <li key={ch.title}>
                  <ChapterPlayer
                    title={ch.title}
                    ready={ch.ready}
                    downloadUrl={ch.downloadUrl}
                    seed={`${id}-${ch.title}`}
                  />
                </li>
              ))}
            </ul>
          </section>

          <details className="text-sm text-ink-muted">
            <summary className="cursor-pointer text-accent-secondary">
              Developer
            </summary>
            <p className="mt-2">
              Live log:{" "}
              <code className="text-ink-primary">
                src/data/jobs/{id}/progress.log
              </code>{" "}
              (also printed in the terminal where the worker runs)
            </p>
          </details>
        </div>
      )}
    </main>
  );
}
