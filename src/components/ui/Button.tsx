import { cn } from "@/lib/ui/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({
  variant = "primary",
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-accent text-onAccent shadow-[0_4px_14px_-4px_rgba(13,148,136,0.45)] hover:brightness-105"
      : "surface-subtle text-ink-primary hover:bg-black/[0.06]";
  return (
    <button
      className={cn(base, styles, className)}
      disabled={disabled}
      {...props}
    />
  );
}
