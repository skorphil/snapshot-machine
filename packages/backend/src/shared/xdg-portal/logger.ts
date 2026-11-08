import { logger as rootLogger } from "@btrbk-gui/backend/shared/logger.ts";

/** Logger scoped to the XDG portal file chooser helpers. */
export const logger = rootLogger.child("portal-picker");
