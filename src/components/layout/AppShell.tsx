import Link from "next/link";
import { Headphones } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="app-starfield" aria-hidden />
      <div className="relative flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-5 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-ink-primary transition hover:text-accent"
          >
            <Headphones className="h-5 w-5 text-accent" strokeWidth={1.5} />
            <span className="font-display text-sm font-semibold tracking-tight md:text-base">
              Audiobook Generator
            </span>
          </Link>
        </header>
        <div className="flex-1 animate-page-in">{children}</div>
      </div>
    </>
  );
}
