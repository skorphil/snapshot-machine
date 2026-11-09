/**
 * Resolves the current user's home directory from the `HOME` environment
 * variable.
 *
 * Falls back to the filesystem root when `HOME` is unset or empty, so callers
 * always receive a usable absolute path.
 *
 * @returns The absolute home directory path.
 */
export function getHomeDirectory(): string {
  const home = Deno.env.get("HOME")?.trim();
  return home && home.startsWith("/") ? home : "/";
}
