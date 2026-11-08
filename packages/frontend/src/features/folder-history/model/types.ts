/** Which filesystem timestamp is shown per version. */
export type DateMode = "modified" | "arrival";

/** Type guard that narrows a string to {@link DateMode}. */
export function isDateMode(value: string): value is DateMode {
  return value === "modified" || value === "arrival";
}
