import type { DesktopBindings } from "@snapshot-machine/shared/types.ts";

declare global {
  var bindings: DesktopBindings;
}

/** Forwards a diagnostic to the backend log, falling back to the console. */
export function logFromWebview(msg: unknown): void {
  const send = globalThis.bindings?.logFromWebview;
  if (typeof send === "function") {
    send(msg);
  } else {
    console.error("[webview] logFromWebview unavailable", msg);
  }
}

/** Returns the native functions exposed by the Deno Desktop host. */
export function getBindings(): DesktopBindings {
  logFromWebview({
    type: typeof globalThis.bindings,
    keys: globalThis.bindings ? Object.keys(globalThis.bindings) : null,
    href: location.href,
  });
  return globalThis.bindings;
}
