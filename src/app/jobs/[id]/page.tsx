"use client";

import { useEffect, useState } from "react";

type JobStatus = {
  id: number;
  status: string;
  error: string | null;
  progress: number;
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

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">Job #{id}</h1>
      {!job ? (
        <p className="mt-4 text-zinc-400">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            Status: <span className="text-zinc-200">{job.status}</span>
          </p>
          <p className="text-sm">Progress: {job.progress}%</p>
          {job.error && (
            <p className="text-sm text-red-400">{job.error}</p>
          )}
          <ul className="space-y-2 text-sm">
            {job.chapters.map((ch) => (
              <li key={ch.title} className="flex items-center justify-between gap-2">
                <span className="truncate">{ch.title}</span>
                {ch.ready ? (
                  <a
                    href={ch.downloadUrl}
                    className="text-indigo-400 hover:underline"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-zinc-500">pending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
