/** The Attention screen's persisted filter object (docs/16 §1.3, docs/18
 *  §2–§3). The Calendar reads and writes the client and module in it too,
 *  so the two screens always agree (§5). Windows are cumulative values
 *  ("7" | "15" | "30"); the old lane buckets are migrated on read
 *  (`filters-migrate.ts`, Q49). */
import type { TileFilter, WindowValue } from "./windows";
import type { Module } from "./types";

export interface AttentionFilters {
  clientId: string;
  ay: string;
  module: "" | Module;
  status: string;
  owner: string;
  tile: TileFilter;
  issued: WindowValue;
  due: WindowValue;
  /** docs/18 §3.3 chips. */
  notViewedByAo: boolean;
  /** "" | "30" | "60" | "90" */
  limitation: "" | "30" | "60" | "90";
  /** Notice-type pill keys (`notice-type.ts`), AND-ed with the rest. */
  types: string[];
}

export const DEFAULT_FILTERS: AttentionFilters = {
  clientId: "", ay: "", module: "", status: "", owner: "", tile: "", issued: "", due: "",
  notViewedByAo: false, limitation: "", types: [],
};

export const ATTENTION_SCREEN = "attention";
