// @ts-types="@/shared/types/css-module.d.ts"
import styles from "./FileSnippet.module.css";

import { FileText, SquareDashedXCorner } from "lucide-react";
import type { FileHistoryEntry } from "@snapshot-machine/shared/types.ts";
import { formatVersionCount, summarizeEntry } from "../model/file-snippet.ts";

/** A selectable row summarising one file across its snapshot history. */
export function FileSnippet({
  entry,
  selected,
  onSelect,
}: FileSnippetProps) {
  const summary = summarizeEntry(entry);
  const Icon = entry.deleted ? SquareDashedXCorner : FileText;
  const fileName = summary.extension
    ? `${summary.stem}.${summary.extension}`
    : summary.stem;

  return (
    <button
      type="button"
      className={styles.snippet}
      aria-pressed={selected}
      data-selected={selected || undefined}
      data-deleted={entry.deleted || undefined}
      onClick={onSelect}
    >
      <span className={styles.icon} aria-hidden>
        <Icon size={18} />
      </span>
      <span className={styles.body}>
        <span className={styles.name}>
          {fileName}
        </span>
        <span className={styles.meta}>
          Edited: {summary.editedLabel} - {summary.sizeLabel}
        </span>
      </span>
      <span className={styles.versions}>
        {formatVersionCount(summary.versionCount)}
      </span>
    </button>
  );
}

/** Props for {@link FileSnippet}. */
export type FileSnippetProps = {
  entry: FileHistoryEntry;
  selected: boolean;
  onSelect: () => void;
};
