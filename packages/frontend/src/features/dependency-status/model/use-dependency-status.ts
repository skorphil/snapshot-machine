import { useEffect, useState } from "react";
import type { DependencyReport } from "@snapshot-machine/shared/types.ts";
import { getDependencyStatus } from "../api/index.ts";
import { logger } from "@/shared/logger.ts";

/** Lifecycle of the dependency check: pending until the backend answers. */
export type DependencyState =
  | { status: "checking" }
  | { status: "ready"; report: DependencyReport }
  | { status: "error"; message: string };

/**
 * Runs the dependency check once on mount and exposes its result. A failure
 * to reach the backend is reported as an error state rather than as "ready".
 */
export function useDependencyStatus(): DependencyState {
  const [state, setState] = useState<DependencyState>({ status: "checking" });

  useEffect(() => {
    let active = true;
    getDependencyStatus()
      .then((report) => {
        if (active) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        logger.error("Dependency check failed:", error);
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
