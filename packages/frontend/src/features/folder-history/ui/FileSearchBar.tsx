// @ts-types="@/shared/types/css-module.d.ts"
import styles from "./FileSearchBar.module.css";

import type React from "react";
import { FolderOpen, Search } from "lucide-react";

/** Address bar with a native folder picker trigger and a path input. */
export function FileSearchBar({
  path,
  onPathChange,
  onBrowse,
  onScan,
  scanDisabled,
  scanLabel,
}: FileSearchBarProps) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scanDisabled) onScan();
  };

  return (
    <form className={styles.bar} onSubmit={handleSubmit} role="search">
      <button
        type="button"
        className={styles.iconButton}
        onClick={onBrowse}
        aria-label="Choose folder"
        title="Choose folder"
      >
        <FolderOpen size={18} aria-hidden />
      </button>
      <input
        type="text"
        className={styles.input}
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        placeholder="Browse or paste a path"
        aria-label="Folder path"
        spellCheck={false}
      />
      <button
        type="submit"
        className={styles.submit}
        disabled={scanDisabled}
      >
        <Search size={16} aria-hidden />
        {scanLabel}
      </button>
    </form>
  );
}

/** Props for {@link FileSearchBar}. */
export type FileSearchBarProps = {
  path: string;
  onPathChange: (path: string) => void;
  onBrowse: () => void;
  onScan: () => void;
  /** True while a scan is running or backups are unavailable. */
  scanDisabled: boolean;
  scanLabel: string;
};
