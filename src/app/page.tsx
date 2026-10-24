"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pdf || !email) {
      setError("PDF and email are required.");
      return;
    }
    setLoading(true);
    const form = new FormData();
    form.append("pdf", pdf);
    form.append("email", email);
    if (voice) form.append("voice", voice);

    const res = await fetch("/api/jobs", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Upload failed");
      return;
    }
    router.push(`/jobs/${data.jobId}`);
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Audiobook Generator</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Upload a text PDF. Optional narrator voice: 15–20 seconds.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          PDF
          <input
            type="file"
            accept="application/pdf"
            required
            onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </label>
        <label className="block text-sm">
          Narrator voice sample (optional, 15–20s)
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setVoice(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Uploading…" : "Generate audiobook"}
        </button>
      </form>
    </main>
  );
}
