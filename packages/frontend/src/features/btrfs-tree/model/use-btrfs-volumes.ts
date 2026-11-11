import { useCallback, useEffect, useState } from "react";
import type { BtrfsVolume } from "@snapshot-machine/shared/types.ts";
import { listBtrfsVolumes } from "../api/index.ts";
import { logger } from "@/shared/logger.ts";

/** Reduces a thrown value to a displayable message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State and actions of the btrfs volume list. */
export type BtrfsVolumesState = {
  /** Volumes from the last successful load, empty before the first answer. */
  volumes: BtrfsVolume[];
  /** True while a load is in flight. */
  loading: boolean;
  /** Error from the last failed load, or null. */
  error: string | null;
  /** Loads the volumes again. */
  reload: () => Promise<void>;
};

/**
 * Loads the btrfs volumes through the Root Helper. A failed load keeps the
 * previous volumes and reports the error; `reload` starts a fresh load.
 */
export function useBtrfsVolumes(): BtrfsVolumesState {
  const [volumes, setVolumes] = useState<BtrfsVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCurrent: () => boolean) => {
    setLoading(true);
    try {
      const result = await listBtrfsVolumes();
      if (!isCurrent()) return;
      setVolumes(result);
      setError(null);
    } catch (e) {
      logger.error("listBtrfsVolumes failed:", e);
      if (!isCurrent()) return;
      setError(errorMessage(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [load]);

  const reload = useCallback(() => load(() => true), [load]);

  return { volumes, loading, error, reload };
}
