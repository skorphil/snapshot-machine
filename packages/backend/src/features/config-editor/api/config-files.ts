import type { SaveConfigResult } from "@snapshot-machine/shared/types.ts";
import { withHelper } from "./helper-connection.ts";
import { isHelperRejection } from "./helper-errors.ts";

/** Returns the names of the configuration files managed by the Root Helper. */
export function listConfigFiles(): Promise<string[]> {
  return withHelper((helper) => helper.ListConfigFiles() as Promise<string[]>);
}

/** Returns the content of one configuration file managed by the Root Helper. */
export function readConfigFile(name: string): Promise<string> {
  return withHelper((helper) => helper.ReadConfigFile(name) as Promise<string>);
}

/**
 * Asks the Root Helper to validate and write a configuration file. A rejected
 * request (invalid syntax, invalid name, or denied authorization) is returned
 * as `{ ok: false, error }`; an unreachable helper still throws.
 */
export async function saveConfigFile(
  name: string,
  content: string,
): Promise<SaveConfigResult> {
  try {
    await withHelper((helper) => helper.SaveConfigFile(name, content));
    return { ok: true };
  } catch (error) {
    if (isHelperRejection(error)) {
      return { ok: false, error: error.text };
    }
    throw error;
  }
}
