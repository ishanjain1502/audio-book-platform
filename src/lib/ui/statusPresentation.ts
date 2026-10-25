export type StatusTone = "neutral" | "active" | "done" | "error";

export function statusPresentation(status: string): {
  label: string;
  tone: StatusTone;
} {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "complete") {
    return { label: "Completed", tone: "done" };
  }
  if (normalized === "failed" || normalized === "error") {
    return { label: "Failed", tone: "error" };
  }
  if (
    normalized === "processing" ||
    normalized === "running" ||
    normalized === "active"
  ) {
    return { label: "In progress", tone: "active" };
  }
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return { label, tone: "neutral" };
}
