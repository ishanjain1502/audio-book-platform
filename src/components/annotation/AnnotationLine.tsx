"use client";

import { useRef } from "react";
import { splitDeliveryTags } from "@/lib/annotate/deliveryTags";
import type { AnnotationMessage } from "@/lib/jobs/readAnnotation";

const capsuleClass =
  "mx-0.5 inline-flex items-center rounded-full border border-accent/50 bg-accent/10 px-1.5 py-0.5 text-xs text-accent";

const lineButtonClass =
  "surface-subtle inline-flex min-h-8 items-center rounded-full px-3 text-xs text-ink-primary hover:bg-black/[0.06] disabled:opacity-50";

export function AnnotationLine({
  message,
  characters,
  paragraphLineCount,
  editing,
  draft,
  writing,
  onDraft,
  onOpen,
  onBlur,
  onSpeaker,
  onAdd,
  onSplit,
  onDelete,
}: {
  message: AnnotationMessage;
  characters: { name: string; speakerIndex: number }[];
  paragraphLineCount: number;
  editing: boolean;
  draft: string;
  writing: boolean;
  onDraft: (value: string) => void;
  onOpen: () => void;
  onBlur: () => void;
  onSpeaker: (speakerIndex: number) => void;
  onAdd: () => void;
  onSplit: (cursor: number) => void;
  onDelete: () => void;
}) {
  const lineRef = useRef<HTMLLIElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokens = splitDeliveryTags(message.text);

  return (
    <li ref={lineRef} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-primary">{message.speakerName}</span>
        <select
          value={message.speakerIndex}
          disabled={writing}
          className="surface-input min-h-9 max-w-xs rounded-xl px-3 py-1.5 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          onChange={(event) => onSpeaker(Number(event.target.value))}
        >
          {characters.map((character) => (
            <option key={character.speakerIndex} value={character.speakerIndex}>
              {character.name}
            </option>
          ))}
        </select>
      </div>
      {editing ? (
        <textarea
          ref={textareaRef}
          aria-label={`Edit ${message.speakerName}`}
          value={draft}
          disabled={writing}
          className="surface-input min-h-20 w-full rounded-xl px-3 py-2 text-ink-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          onChange={(event) => onDraft(event.target.value)}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && lineRef.current?.contains(next)) return;
            onBlur();
          }}
        />
      ) : (
        <button
          type="button"
          className="min-h-6 w-full whitespace-pre-wrap text-left text-ink-primary"
          aria-label={`Edit ${message.speakerName}`}
          onClick={onOpen}
        >
          {tokens.length === 0
            ? "\u00a0"
            : tokens.map((token, index) =>
                token.kind === "tag" ? (
                  <span key={index} className={capsuleClass}>
                    {token.value}
                  </span>
                ) : (
                  <span key={index}>{token.value}</span>
                ),
              )}
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={lineButtonClass}
          disabled={writing}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAdd}
        >
          Add
        </button>
        <button
          type="button"
          className={lineButtonClass}
          disabled={writing || !editing}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSplit(textareaRef.current?.selectionStart ?? draft.length)}
        >
          Split
        </button>
        <button
          type="button"
          className={lineButtonClass}
          disabled={writing || paragraphLineCount < 2}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
