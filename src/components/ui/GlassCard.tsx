import { cn } from "@/lib/ui/cn";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
};

export function GlassCard({ children, className, accent }: GlassCardProps) {
  return (
    <div
      className={cn(
        accent ? "glass-panel-accent" : "glass-panel",
        "p-5 md:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
