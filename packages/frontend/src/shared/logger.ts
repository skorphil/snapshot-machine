import { createLogger } from "@snapshot-machine/shared/logger.ts";

/** Application logger for the frontend, scoped as `frontend`. */
export const logger = createLogger("frontend", {
  production: import.meta.env.PROD,
});
