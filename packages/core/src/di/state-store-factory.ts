/**
 * State store factory — creates SQLite store for core package.
 */

import type { IStateStore } from "../domain/ports/state-store.port.js";
import { SqliteStateStore } from "../state/store.js";

export interface StateStoreConfig {
	sqlitePath: string;
}

export function createStateStore(config: StateStoreConfig): IStateStore {
	return new SqliteStateStore(config.sqlitePath);
}
