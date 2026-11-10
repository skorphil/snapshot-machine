import type React from "react";
import { useConfigEditor } from "../model/use-config-editor.ts";

/** Spaces inserted for one Tab press, so the textarea keeps indentation predictable. */
const TAB = "  ";

/** Props of the raw configuration editor. */
export type ConfigEditorProps = {
  /**
   * Optional controls rendered next to the save actions, e.g. a backup trigger.
   * Receives whether the editor has unsaved changes.
   */
  renderExtraControls?: (
    state: { hasUnsavedChanges: boolean },
  ) => React.ReactNode;
};

/**
 * Raw editor for the pre-configured btrbk drop-in file in /etc/btrbk/gui.conf.d.
 * Saves go through the Root Helper, which validates the content with btrbk and
 * requires Polkit authorization before writing.
 */
export function ConfigEditor({ renderExtraControls }: ConfigEditorProps) {
  const editor = useConfigEditor();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd, value } = target;
    const next = value.slice(0, selectionStart) + TAB +
      value.slice(selectionEnd);
    editor.setContent(next);
    // Restore the caret after React commits the new value.
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + TAB.length;
    });
  };

  const canSave = !editor.loading && editor.dirty && !editor.saving;

  return (
    <div className="config-editor">
      <div className="config-editor-toolbar">
        <p className="config-editor-file">
          <span className="config-editor-label">File</span>
          <code className="config-editor-path" title={editor.filePath}>
            {editor.filePath}
          </code>
        </p>

        <div className="config-editor-actions">
          <button
            type="button"
            onClick={editor.applyTemplate}
            disabled={editor.loading || editor.saving}
          >
            Reset Template
          </button>
          <button
            type="button"
            className="config-editor-save"
            onClick={() => void editor.save()}
            disabled={!canSave}
          >
            {editor.saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {renderExtraControls?.({ hasUnsavedChanges: editor.dirty })}

      {editor.error && (
        <p className="error config-editor-error" role="alert">
          {editor.error}
        </p>
      )}

      <textarea
        className="config-editor-text"
        aria-label="Configuration content"
        value={editor.content}
        onChange={(e) => editor.setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={editor.loading || editor.saving}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        rows={24}
        placeholder={editor.loading ? "Loading..." : "Empty configuration."}
      />

      <p className="config-editor-status">
        {editor.exists ? "" : "Not saved yet. "}
        {editor.dirty ? "Unsaved changes." : ""}
      </p>
    </div>
  );
}
