import { createLogger } from "@btrbk-gui/shared/logger.ts";

/** Application logger for the backend, scoped as `backend`. */
export const logger = createLogger("backend", {
  production: Deno.env.get("NODE_ENV") === "production",
});
