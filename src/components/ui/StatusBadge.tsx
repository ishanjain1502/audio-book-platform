import { statusPresentation } from "@/lib/ui/statusPresentation";
import { cn } from "@/lib/ui/cn";

type StatusBadgeProps = {
  status: string;
};

const toneStyles = {
  neutral: "border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-ink-muted",
  active: "border-accent/50 bg-accent/10 text-accent",
  done: "border-semantic-success/40 bg-semantic-success/10 text-semantic-success",
  error: "border-semantic-error/40 bg-semantic-error/10 text-semantic-error",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, tone } = statusPresentation(status);
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium",
        toneStyles[tone],
      )}
    >
      {label}
    </span>
  );
}
