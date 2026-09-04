import { useSyncExternalStore } from "react";

import { hubSnapshot, subscribeHub, type HubState } from "@/app/hub-store";

export function useHub(): HubState {
  return useSyncExternalStore(subscribeHub, hubSnapshot, hubSnapshot);
}
