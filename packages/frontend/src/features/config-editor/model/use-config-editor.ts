import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG_NAME } from "@snapshot-machine/shared/config-name.ts";
import { DEFAULT_CONFIG_TEMPLATE } from "@snapshot-machine/shared/default-config-template.ts";
import {
  getConfigName,
  getConfigPath,
  listConfigFiles,
  readConfigFile,
  saveConfigFile,
} from "../api/index.ts";
import { logger } from "@/shared/logger.ts";

/** Message shown before replacing content that has unsaved edits. */
const DISCARD_WARNING = "Discard unsaved changes?";

/** Reduces a thrown value to a displayable message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State and actions of the raw configuration editor. */
export type ConfigEditorState = {
  /** Name of the file the editor targets. */
  fileName: string;
  /** Full path of the file the editor targets, e.g. /etc/btrbk/gui.conf.d/snapshot-machine.conf. */
  filePath: string;
  /** True when the file already exists in gui.conf.d. */
  exists: boolean;
  /** Editor content, including unsaved edits. */
  content: string;
  /** Content as last loaded from or saved to the helper. */
  savedContent: string;
  /** True while the file is loading. */
  loading: boolean;
  /** True while a save request is in flight. */
  saving: boolean;
  /** Error from the last failed operation, or null. */
  error: string | null;
  /** True when the editor content differs from the saved content. */
  dirty: boolean;
  /** Replaces the editor content. */
  setContent: (content: string) => void;
  /** Replaces the editor content with DEFAULT_CONFIG_TEMPLATE, asking before discarding unsaved edits. */
  applyTemplate: () => void;
  /** Saves the editor content to the target file through the helper. */
  save: () => Promise<void>;
};

/**
 * Loads the managed drop-in file and manages its unsaved edits and the save
 * lifecycle. When the file does not exist yet, the editor is pre-filled with
 * DEFAULT_CONFIG_TEMPLATE and starts dirty, so the template can be saved as is.
 * Save results come from the Root Helper, which rejects content that btrbk
 * does not accept.
 */
export function useConfigEditor(): ConfigEditorState {
  const [fileName, setFileName] = useState(DEFAULT_CONFIG_NAME);
  const [filePath, setFilePath] = useState(DEFAULT_CONFIG_NAME);
  const [exists, setExists] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== savedContent;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name = DEFAULT_CONFIG_NAME;
      try {
        name = await getConfigName();
      } catch (e) {
        logger.warn("getConfigName failed, using default:", e);
      }
      if (cancelled) return;
      setFileName(name);
      try {
        const path = await getConfigPath().catch((e) => {
          logger.warn("getConfigPath failed, showing file name:", e);
          return name;
        });
        if (cancelled) return;
        setFilePath(path);
        const files = await listConfigFiles();
        if (cancelled) return;
        if (files.includes(name)) {
          const text = await readConfigFile(name);
          if (cancelled) return;
          setExists(true);
          setContent(text);
          setSavedContent(text);
        } else {
          setExists(false);
          setContent(DEFAULT_CONFIG_TEMPLATE);
          setSavedContent("");
        }
      } catch (e) {
        logger.error("loading config editor file failed:", e);
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyTemplate = useCallback(() => {
    if (dirty && !globalThis.confirm(DISCARD_WARNING)) return;
    setError(null);
    setContent(DEFAULT_CONFIG_TEMPLATE);
  }, [dirty]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveConfigFile(fileName, content);
      if (result.ok) {
        setExists(true);
        setSavedContent(content);
      } else {
        setError(result.error ?? "Save failed");
      }
    } catch (e) {
      logger.error("saveConfigFile failed:", e);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [content, fileName]);

  return {
    fileName,
    filePath,
    exists,
    content,
    savedContent,
    loading,
    saving,
    error,
    dirty,
    setContent,
    applyTemplate,
    save,
  };
}
