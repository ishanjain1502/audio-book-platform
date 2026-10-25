import { cn } from "@/lib/ui/cn";

type JobProgressProps = {
  value: number;
  pulsing?: boolean;
};

export function JobProgress({ value, pulsing }: JobProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="w-full">
      <div
        className={cn(
          "relative mx-auto flex h-28 w-28 items-center justify-center md:hidden",
          pulsing && "animate-pulse",
        )}
      >
        <svg className="-rotate-90 h-28 w-28" viewBox="0 0 96 96" aria-hidden>
          <circle
            cx="48"
            cy="48"
            r="42"
            fill="none"
            stroke="var(--progress-track)"
            strokeWidth="6"
          />
          <circle
            cx="48"
            cy="48"
            r="42"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute text-sm font-medium text-ink-primary">
          {clamped}%
        </span>
      </div>

      <div className="hidden md:block">
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>Progress</span>
          <span>{clamped}%</span>
        </div>
        <div
          className={cn(
            "h-2 overflow-hidden rounded-full bg-[var(--progress-track)]",
            pulsing && "animate-pulse",
          )}
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  );
}
