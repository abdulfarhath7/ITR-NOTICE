/** The Attention screen's persisted filter object (docs/16 §1.3). The
 *  Calendar reads and writes the client and module in it too, so the two
 *  screens always agree (§5). */
import type { DueBucket, IssuedBucket, Tile } from "./buckets";
import type { Module } from "./types";

export interface AttentionFilters {
  clientId: string;
  ay: string;
  module: "" | Module;
  status: string;
  owner: string;
  tile: "" | Tile;
  issued: "" | IssuedBucket;
  due: "" | DueBucket;
}

export const DEFAULT_FILTERS: AttentionFilters = {
  clientId: "", ay: "", module: "", status: "", owner: "", tile: "", issued: "", due: "",
};

export const ATTENTION_SCREEN = "attention";
