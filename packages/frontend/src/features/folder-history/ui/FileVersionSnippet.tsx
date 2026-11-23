// @ts-types="@/shared/types/css-module.d.ts"
import styles from "./FileVersionSnippet.module.css";

import { FolderOpen, Undo2 } from "lucide-react";
import type { FileVersion } from "@snapshot-machine/shared/types.ts";
import { summarizeVersion } from "../model/file-snippet.ts";

/** One snapshot version of the selected file, with reveal and restore actions. */
export function FileVersionSnippet({
  version,
  onRestore,
  onReveal,
  restoreDisabled,
}: FileVersionSnippetProps) {
  const summary = summarizeVersion(version);

  return (
    <li className={styles.snippet}>
      <div className={styles.info}>
        <span className={styles.dateTime}>{summary.dateTimeLabel}</span>
        {summary.renamedLabel && (
          <span className={styles.renamed}>{summary.renamedLabel}</span>
        )}
        <span className={styles.snapshot} title={version.snapshot}>
          {version.snapshot}
        </span>
      </div>
      <span className={styles.size}>{summary.sizeLabel}</span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onReveal}
          disabled={!onReveal}
          aria-label="Open version folder"
          title="Open version folder"
        >
          <FolderOpen size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onRestore}
          disabled={restoreDisabled}
          aria-label="Restore this version"
          title="Restore this version"
        >
          <Undo2 size={16} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** Props for {@link FileVersionSnippet}. */
export type FileVersionSnippetProps = {
  version: FileVersion;
  onRestore: () => void;
  /** Omit when no reveal action is available; the button is then disabled. */
  onReveal?: () => void;
  restoreDisabled: boolean;
};
