"use client";

import { useState } from "react";
import Link from "next/link";
import { coverGradientFromSeed } from "@/lib/ui/coverGradient";
import { sampleBookAction, type SampleBook } from "@/lib/sampleLibrary";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";

const selectClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-onAccent shadow-[0_4px_14px_-4px_rgba(13,148,136,0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function SampleBookTile({ book }: { book: SampleBook }) {
  const [failed, setFailed] = useState(false);
  const action = sampleBookAction(book);
  const showImage = Boolean(book.image) && !failed;
  const { from, to } = coverGradientFromSeed(book.title);
  const isbn = book.isbn?.trim() ?? "";

  return (
    <li className="h-full">
      <GlassCard className="flex h-full flex-col">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored Open Library URL, not next/image
          <img
            src={book.image}
            alt={book.title}
            className="aspect-[2/3] w-full rounded-xl object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="aspect-[2/3] w-full rounded-xl"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
            aria-hidden
          />
        )}
        <h3 className="mt-4 font-display line-clamp-2 text-base font-semibold tracking-tight text-ink-primary">
          {book.title}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">{book.author}</p>
        {isbn ? (
          <p className="mt-1 text-xs text-ink-muted">ISBN {isbn}</p>
        ) : null}
        <div className="mt-auto pt-4">
          {action.href ? (
            <Link href={action.href} className={selectClass}>
              {action.label}
            </Link>
          ) : (
            <Button type="button" disabled className="w-full">
              {action.label}
            </Button>
          )}
        </div>
      </GlassCard>
    </li>
  );
}

export function SampleLibrary({ books }: { books: SampleBook[] }) {
  if (books.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-primary">
        Library
      </h2>
      <p className="mt-2 text-sm text-ink-muted md:text-base">
        Finished samples you can open and judge.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {books.map((book) => (
          <SampleBookTile key={book.title} book={book} />
        ))}
      </ul>
    </section>
  );
}
