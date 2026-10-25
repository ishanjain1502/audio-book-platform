import { Download } from "lucide-react";
import { coverGradientFromSeed } from "@/lib/ui/coverGradient";
import { cn } from "@/lib/ui/cn";

type ChapterPlayerProps = {
  title: string;
  ready: boolean;
  downloadUrl: string;
  seed: string;
  showReadyAnimation?: boolean;
};

export function ChapterPlayer({
  title,
  ready,
  downloadUrl,
  seed,
  showReadyAnimation = true,
}: ChapterPlayerProps) {
  const { from, to } = coverGradientFromSeed(seed);

  return (
    <div
      className={cn(
        "glass-panel flex flex-col gap-3 p-4 md:p-5",
        ready && showReadyAnimation && "animate-chapter-ready",
      )}
    >
      <div className="flex gap-3">
        <div
          className="h-16 w-16 shrink-0 rounded-xl md:h-20 md:w-20"
          style={{
            background: `linear-gradient(135deg, ${from}, ${to})`,
          }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-display line-clamp-2 text-base font-semibold tracking-tight text-ink-primary md:text-lg">
            {title}
          </h3>
          {!ready && (
            <p className="mt-1 text-sm text-ink-muted">Pending</p>
          )}
        </div>
      </div>
      {ready && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <audio
            controls
            preload="none"
            src={downloadUrl}
            className="h-10 min-w-0 w-full flex-1"
          />
          <a
            href={`${downloadUrl}?download=1`}
            className="surface-subtle inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm text-ink-primary transition hover:bg-black/[0.06]"
          >
            <Download className="h-4 w-4 text-accent" strokeWidth={1.5} />
            Download
          </a>
        </div>
      )}
    </div>
  );
}
