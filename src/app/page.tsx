"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { GlassCard } from "@/components/ui/GlassCard";

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
    router.push(`/jobs/${data.jobId}/review`);
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-12 sm:px-6">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl lg:text-[2.75rem]">
          Turn your PDF into an audiobook
        </h1>
        <p className="mt-3 text-sm text-ink-muted md:text-base">
          Upload a text PDF. Optional narrator voice: 15–20 seconds for a custom
          tone.
        </p>
      </div>

      <GlassCard accent>
        <form onSubmit={onSubmit} className="space-y-6">
          <label className="block text-sm">
            <span className="text-ink-primary">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="surface-input mt-2 min-h-11 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <FileDropzone
            label="PDF"
            accept="application/pdf"
            file={pdf}
            onFile={setPdf}
            hint="Text-based PDF required"
          />

          <FileDropzone
            label="Narrator voice sample (optional)"
            accept="audio/*"
            file={voice}
            onFile={setVoice}
            hint="15–20 seconds of clear speech"
          />

          {error && <p className="text-sm text-semantic-error">{error}</p>}

          <Button
            type="submit"
            disabled={loading}
            className="w-full gap-2 md:w-auto md:max-w-xs"
          >
            {loading ? (
              "Uploading…"
            ) : (
              <>
                <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                Generate audiobook
              </>
            )}
          </Button>
        </form>
      </GlassCard>
    </main>
  );
}
