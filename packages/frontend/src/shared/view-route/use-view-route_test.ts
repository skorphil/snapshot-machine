/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import {
  DEFAULT_VIEW_ROUTE,
  parseViewRoute,
  readViewRoute,
  subscribeToViewRoute,
  writeViewRoute,
} from "./use-view-route.ts";

/** Installs a minimal `location` stand-in that normalizes hashes like a browser. */
function withFakeLocation(run: (location: { hash: string }) => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = {
    _hash: "",
    get hash() {
      return this._hash;
    },
    set hash(value: string) {
      const trimmed = value.replace(/^#/, "");
      this._hash = trimmed === "" ? "" : `#${trimmed}`;
    },
  };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    get: () => fake,
  });
  try {
    run(fake);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "location", original);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  }
}

Deno.test("parseViewRoute accepts known views with standard #/ prefix", () => {
  assertEquals(parseViewRoute("#/history"), "history");
  assertEquals(parseViewRoute("#/sizes"), "sizes");
  assertEquals(parseViewRoute("#/config"), "config");
});

Deno.test("parseViewRoute falls back to default for missing, non-standard, or unknown hash", () => {
  assertEquals(parseViewRoute(""), DEFAULT_VIEW_ROUTE);
  assertEquals(parseViewRoute("#"), DEFAULT_VIEW_ROUTE);
  assertEquals(parseViewRoute("#config"), DEFAULT_VIEW_ROUTE);
  assertEquals(parseViewRoute("#/unknown"), DEFAULT_VIEW_ROUTE);
});

Deno.test("hash change updates the route read from location", () => {
  withFakeLocation((location) => {
    assertEquals(readViewRoute(), "history");

    let notifications = 0;
    const unsubscribe = subscribeToViewRoute(() => {
      notifications++;
    });

    location.hash = "#/sizes";
    globalThis.dispatchEvent(new Event("hashchange"));
    assertEquals(notifications, 1);
    assertEquals(readViewRoute(), "sizes");

    location.hash = "#/config";
    globalThis.dispatchEvent(new Event("hashchange"));
    assertEquals(notifications, 2);
    assertEquals(readViewRoute(), "config");

    unsubscribe();
    location.hash = "#/history";
    globalThis.dispatchEvent(new Event("hashchange"));
    assertEquals(notifications, 2);
  });
});

Deno.test("writeViewRoute updates location hash", () => {
  withFakeLocation((location) => {
    writeViewRoute("sizes");
    assertEquals(location.hash, "#/sizes");
    assertEquals(readViewRoute(), "sizes");

    writeViewRoute("config");
    assertEquals(location.hash, "#/config");

    writeViewRoute("history");
    assertEquals(location.hash, "#/history");
  });
});
