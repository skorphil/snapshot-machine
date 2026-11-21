import { useSyncExternalStore } from "react";

/** Top-level views switchable from the tab bar. */
export const VIEW_ROUTES = ["history", "sizes", "config"] as const;

export type ViewRoute = (typeof VIEW_ROUTES)[number];

/** Route used when the hash is missing or does not name a known view. */
export const DEFAULT_VIEW_ROUTE: ViewRoute = "history";

/** Narrows an arbitrary string to a known view route. */
export function isViewRoute(value: string): value is ViewRoute {
  return (VIEW_ROUTES as readonly string[]).includes(value);
}

/**
 * Parses a location hash adhering to the standard `#/route` format.
 * Missing, non-standard, or unknown values fall back to {@link DEFAULT_VIEW_ROUTE}.
 */
export function parseViewRoute(hash: string): ViewRoute {
  const name = hash.startsWith("#/") ? hash.slice(2) : "";
  return isViewRoute(name) ? name : DEFAULT_VIEW_ROUTE;
}

/** Returns the current view route from `globalThis.location.hash`. */
export function readViewRoute(): ViewRoute {
  return parseViewRoute(globalThis.location.hash);
}

/** Writes the given view route into `globalThis.location.hash` (e.g. `#/sizes`). */
export function writeViewRoute(route: ViewRoute): void {
  globalThis.location.hash = `/${route}`;
}

/** Subscribes to hash changes; returns the unsubscribe function. */
export function subscribeToViewRoute(onChange: () => void): () => void {
  globalThis.addEventListener("hashchange", onChange);
  return () => globalThis.removeEventListener("hashchange", onChange);
}

/**
 * Hash-based view routing shared by the application tabs.
 * Returns the active view and a setter that updates the URL hash.
 */
export function useViewRoute(): [ViewRoute, (route: ViewRoute) => void] {
  const route = useSyncExternalStore(
    subscribeToViewRoute,
    readViewRoute,
    () => DEFAULT_VIEW_ROUTE,
  );
  return [route, writeViewRoute];
}
