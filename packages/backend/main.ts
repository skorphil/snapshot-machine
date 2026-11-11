import type { DesktopBindings } from "@snapshot-machine/shared/types.ts";
import { fileURLToPath } from "node:url";
import { logger } from "@snapshot-machine/backend/shared/logger.ts";
import { getHomeDirectory } from "@snapshot-machine/backend/shared/home-directory.ts";
import {
  getConfigName,
  getConfigNamePath,
} from "@snapshot-machine/backend/shared/btrbk-config/index.ts";
import { listFolderHistory } from "@snapshot-machine/backend/features/folder-history/index.ts";
import { pickFolder } from "@snapshot-machine/backend/features/folder-picker/index.ts";
import {
  assertDependenciesAvailable,
  checkDependencies,
} from "@snapshot-machine/backend/features/dependency-check/index.ts";
import {
  restoreFile,
  saveFile,
} from "@snapshot-machine/backend/features/restore/index.ts";
import {
  getSchedule,
  getScheduleStatus,
  setSchedule,
} from "@snapshot-machine/backend/features/backup-schedule/index.ts";
import {
  getBackupStatus,
  listConfigFiles,
  readConfigFile,
  runBackup,
  saveConfigFile,
} from "@snapshot-machine/backend/features/config-editor/index.ts";

// `Deno.BrowserWindow` only exists when running inside `deno desktop` and is
// not part of Deno's type definitions, so it is read reflectively.
const browserWindowConstructor: unknown = Reflect.get(Deno, "BrowserWindow");

if (typeof browserWindowConstructor !== "function") {
  throw new Error("Snapshot Machine must be started with `deno desktop`.");
}

const BrowserWindow = browserWindowConstructor as BrowserWindowConstructor;
const win = new BrowserWindow({
  title: "Snapshot Machine",
  width: 1000,
  height: 700,
});
if (Deno.env.get("VITE_DEV_URL")) {
  win.openDevtools({ renderer: true });
}

const dependencyReport = await checkDependencies();
if (!dependencyReport.ok) {
  logger.warn(
    "Missing dependencies, backup operations are disabled:",
    dependencyReport.dependencies.filter((d) => !d.available),
  );
}

const bindings = {
  pickFolder: async (title) => await pickFolder(title),
  saveFile: async (opts) => await saveFile(opts),
  getDependencyStatus: () => checkDependencies(),
  getHomeDirectory: () => Promise.resolve(getHomeDirectory()),
  listFolderHistory: async (path) => {
    await assertDependenciesAvailable();
    return await listFolderHistory(path);
  },
  restoreFile: async (src, dest) => {
    await assertDependenciesAvailable();
    await restoreFile(src, dest);
  },
  logFromWebview: (msg) => logger.info("[webview]", msg),
  getConfigName: () => Promise.resolve(getConfigName()),
  getConfigPath: () => Promise.resolve(getConfigNamePath()),
  listConfigFiles: () => listConfigFiles(),
  readConfigFile: (name) => readConfigFile(name),
  saveConfigFile: (name, content) => saveConfigFile(name, content),
  runBackup: () => runBackup(),
  getBackupStatus: () => getBackupStatus(),
  getSchedule: () => getSchedule(),
  setSchedule: (interval, enabled) => setSchedule(interval, enabled),
  getScheduleStatus: () => getScheduleStatus(),
} satisfies DesktopBindings;

win.bind("pickFolder", bindings.pickFolder);
win.bind("saveFile", bindings.saveFile);
win.bind("getDependencyStatus", bindings.getDependencyStatus);
win.bind("getHomeDirectory", bindings.getHomeDirectory);
win.bind("listFolderHistory", bindings.listFolderHistory);
win.bind("restoreFile", bindings.restoreFile);
win.bind("logFromWebview", bindings.logFromWebview);
win.bind("getConfigName", bindings.getConfigName);
win.bind("getConfigPath", bindings.getConfigPath);
win.bind("listConfigFiles", bindings.listConfigFiles);
win.bind("readConfigFile", bindings.readConfigFile);
win.bind("saveConfigFile", bindings.saveConfigFile);
win.bind("runBackup", bindings.runBackup);
win.bind("getBackupStatus", bindings.getBackupStatus);
win.bind("getSchedule", bindings.getSchedule);
win.bind("setSchedule", bindings.setSchedule);
win.bind("getScheduleStatus", bindings.getScheduleStatus);

win.addEventListener("close", () => {
  logger.info("Window close event received. Exiting...");
  Deno.exit(0);
});

/** MIME types for the file kinds emitted by the Vite build. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Returns the Content-Type for a file path, defaulting to octet-stream. */
function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** Headers that apply only to a single transport-level connection. */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Returns a copy of the headers without hop-by-hop entries. */
function withoutHopByHop(headers: Headers): Headers {
  const copy = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    copy.delete(name);
  }
  return copy;
}

/**
 * Bridges a browser WebSocket to the Vite dev server (used by the HMR client).
 * Frames received before the upstream socket opens are queued.
 */
function proxyWebSocket(req: Request, target: URL): Response {
  const requested = req.headers.get("sec-websocket-protocol");
  const protocols = requested
    ? requested.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  const upstreamUrl = new URL(req.url);
  upstreamUrl.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  upstreamUrl.host = target.host;

  const { socket, response } = Deno.upgradeWebSocket(req, {
    protocol: protocols[0],
  });

  const upstream = new WebSocket(upstreamUrl, protocols);
  const queue: (string | ArrayBuffer | Uint8Array)[] = [];

  socket.onmessage = (event) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(event.data);
    } else {
      queue.push(event.data);
    }
  };

  upstream.onopen = () => {
    for (const message of queue.splice(0)) {
      upstream.send(message);
    }
  };

  upstream.onmessage = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };

  upstream.onerror = (err) => {
    logger.error("Vite WebSocket proxy upstream error:", err);
  };

  upstream.onclose = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      // Use 1000 if the code is not allowed for manual close (spec restricted)
      const code =
        event.code === 1000 || (event.code >= 3000 && event.code <= 4999)
          ? event.code
          : 1000;
      socket.close(code, event.reason);
    }
  };

  socket.onclose = (event) => {
    if (upstream.readyState === WebSocket.OPEN) {
      const code =
        event.code === 1000 || (event.code >= 3000 && event.code <= 4999)
          ? event.code
          : 1000;
      upstream.close(code, event.reason);
    }
  };

  return response;
}

/** Forwards a plain HTTP request to the Vite dev server and streams back the reply. */
async function proxyHttp(req: Request, target: URL): Promise<Response> {
  const incoming = new URL(req.url);
  const upstreamUrl = new URL(incoming.pathname + incoming.search, target);

  const headers = withoutHopByHop(req.headers);
  // Ask Vite for an identity-encoded body so the streamed bytes match headers.
  headers.delete("accept-encoding");
  headers.set("host", upstreamUrl.host);

  const hasBody = req.body !== null && req.method !== "GET" &&
    req.method !== "HEAD";

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withoutHopByHop(upstream.headers),
    });
  } catch (error) {
    logger.error("Vite proxy request failed:", upstreamUrl.href, error);
    return new Response("Bad Gateway: Vite dev server unreachable", {
      status: 502,
    });
  }
}

// During `deno desktop --hmr`, the frontend is served by Vite so HMR works.
// The webview must not load Vite directly: bindings are only injected for the
// desktop app's own origin, so Vite is reached through a local proxy instead.
const devUrl = Deno.env.get("VITE_DEV_URL");
if (devUrl) {
  const viteTarget = new URL(devUrl);

  Deno.serve({
    port: 0,
    onListen: ({ port }) => {
      const url = `http://127.0.0.1:${port}/`;
      logger.info("Proxying Vite at", viteTarget.href, "via", url);
      // Small delay to ensure we override the default navigation
      setTimeout(() => win.navigate(url), 500);
    },
  }, (req) => {
    const isUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
    return isUpgrade
      ? proxyWebSocket(req, viteTarget)
      : proxyHttp(req, viteTarget);
  });
} else {
  // Production: serve the Vite build output from packages/frontend/dist.
  const distUrl = new URL("../frontend/dist/", import.meta.url);
  const distDir = fileURLToPath(distUrl);
  const indexPath = fileURLToPath(new URL("index.html", distUrl));

  const indexStat = await Deno.stat(indexPath).catch(() => null);
  if (!indexStat?.isFile) {
    const message =
      `Frontend build not found at ${indexPath}. Run \`deno task build\` first.`;
    logger.error(message);
    throw new Error(message);
  }

  Deno.serve({
    port: 0,
    onListen: ({ port }) => {
      const url = `http://localhost:${port}/index.html`;
      logger.info("Serving frontend from:", distDir, "at", url);
      win.navigate(url);
    },
  }, async (req) => {
    const { pathname } = new URL(req.url);
    const requested = pathname === "/" ? "/index.html" : pathname;

    let filePath: string;
    try {
      filePath = fileURLToPath(
        new URL(`.${decodeURIComponent(requested)}`, distUrl),
      );
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // Reject any path that resolves outside the dist directory.
    if (!filePath.startsWith(distDir)) {
      return new Response("Not Found", { status: 404 });
    }

    const stat = await Deno.stat(filePath).catch(() => null);
    if (!stat?.isFile) {
      return new Response("Not Found", { status: 404 });
    }

    const file = await Deno.open(filePath, { read: true });
    return new Response(file.readable, {
      headers: { "content-type": contentTypeFor(filePath) },
    });
  });
}

/** Options passed to the desktop window constructor. */
type DesktopWindowOptions = {
  title: string;
  width?: number;
  height?: number;
};

/** Minimal surface of a `Deno.BrowserWindow` instance used by this app. */
type DesktopWindow = {
  /** Exposes a function to the frontend under `globalThis.bindings[name]`. */
  bind<K extends keyof DesktopBindings>(
    name: K,
    handler: DesktopBindings[K],
  ): void;
  /** Loads the given URL in the window. */
  navigate(url: string): void;
  /** Opens the webview developer tools. */
  openDevtools(options: { renderer: boolean }): void;
  /** Registers a listener for window lifecycle events. */
  addEventListener(type: "close", listener: () => void): void;
};

/** Constructor signature of `Deno.BrowserWindow`. */
type BrowserWindowConstructor = new (
  options: DesktopWindowOptions,
) => DesktopWindow;
