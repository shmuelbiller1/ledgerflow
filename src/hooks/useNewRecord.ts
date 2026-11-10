import { useEffect } from "react";
import type { NewRecordType } from "../lib/recordLinks";
import { useAuthStore } from "../stores/useAuthStore";
import { useUIStore } from "../stores/useUIStore";

/** Consume a creation link once, including when the destination's list is still empty/loading. */
export function useNewRecord(
  type: NewRecordType,
  canCreate: boolean,
  onCreate: () => void,
) {
  // On a cold link, authentication can finish before workspace membership loads.
  const ready = useAuthStore(
    (s) => !s.user || Boolean(s.getCurrentWorkspace()),
  );
  const requested = useUIStore((s) => s.newRecord);
  useEffect(() => {
    if (
      !ready ||
      requested !== type ||
      useUIStore.getState().newRecord !== type
    )
      return;
    useUIStore.getState().clearNewRecord();
    if (canCreate) onCreate();
  }, [ready, requested, type, canCreate, onCreate]);
}
