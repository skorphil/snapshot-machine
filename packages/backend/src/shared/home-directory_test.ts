/// <reference lib="deno.ns" />
import { assertEquals, assertStrictEquals } from "@std/assert";
import { getHomeDirectory } from "./home-directory.ts";

Deno.test("getHomeDirectory returns a non-empty absolute path", () => {
  const home = getHomeDirectory();
  assertStrictEquals(typeof home, "string");
  assertEquals(home.length > 0, true);
  assertEquals(home.startsWith("/"), true);
});

Deno.test("getHomeDirectory prefers the HOME environment variable", () => {
  const original = Deno.env.get("HOME");
  try {
    Deno.env.set("HOME", "/tmp/snapshot-machine-home");
    assertEquals(getHomeDirectory(), "/tmp/snapshot-machine-home");
  } finally {
    if (original === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", original);
    }
  }
});
