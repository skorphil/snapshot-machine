/** Options for `showPortalFileDialog`. */
export type PortalOptions = {
  /** Which FileChooser method to call. */
  method: "OpenFile" | "SaveFile";
  /** Dialog title. */
  title: string;
  /** Select directories instead of files (`OpenFile` only). */
  directory?: boolean;
  /** File name pre-filled in the dialog (`SaveFile` only). */
  currentName?: string;
  /** Folder shown initially in the dialog. */
  currentFolder?: string;
  /** Label of the confirm button. */
  acceptLabel?: string;
};
