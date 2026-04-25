/**
 * SqliteDefinitionStore — DB-backed definition storage with versioning.
 * Replaces in-memory Maps and JSON file storage.
 * Tracks full revision history for rollback support.
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "agentforge-core/definitions/parser.js";
import type { DefinitionStore } from "agentforge-core/definitions/store.js";
import Database from "better-sqlite3";

export type DefinitionKind =
	| "AgentDefinition"
	| "PipelineDefinition"
	| "NodeDefinition"
	| "Schema";

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

// Resolves to dist/state/migrations/sqlite at runtime and
// src/state/migrations/sqlite in tests/dev. Kept in sync by
// scripts/copy-build-assets.mjs.
const DEFINITIONS_MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"state",
	"migrations",
	"sqlite",
);

function applySqliteMigrationsSync(
	db: Database.Database,
	migrationsDir: string,
): void {
	const runSql: (sql: string) => void = db.exec.bind(db);
	runSql(SCHEMA_MIGRATIONS_DDL);
	const applied = new Set(
		(
			db.prepare("SELECT version FROM schema_migrations").all() as Array<{
				version: string;
			}>
		).map((r) => r.version),
	);
	let entries: string[];
	try {
		entries = readdirSync(migrationsDir);
	} catch {
		return;
	}
	const files = entries.filter((f) => f.endsWith(".sql")).sort();
	for (const name of files) {
		const version = name.slice(0, -".sql".length);
		if (applied.has(version)) continue;
		const sql = readFileSync(join(migrationsDir, name), "utf-8");
		runSql(sql);
		db.prepare(
			"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
		).run(version, new Date().toISOString());
	}
}

export interface ResourceDefinition {
	id: string;
	kind: DefinitionKind;
	name: string;
	version: number;
	specYaml: string;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ResourceDefinitionHistory {
	id: string;
	definitionId: string;
	version: number;
	specYaml: string;
	changedBy: string;
	changeType: "created" | "updated" | "rolled_back" | "deleted";
	createdAt: string;
}

export class SqliteDefinitionStore {
	private readonly db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		applySqliteMigrationsSync(this.db, DEFINITIONS_MIGRATIONS_DIR);
	}

	create(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): ResourceDefinition {
		const now = new Date().toISOString();
		const id = randomUUID();
		const parsedMeta = this.extractMetadata(specYaml);

		this.db
			.prepare(
				`INSERT INTO resource_definitions (id, kind, name, version, spec_yaml, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
			)
			.run(
				id,
				kind,
				name,
				specYaml,
				parsedMeta ? JSON.stringify(parsedMeta) : null,
				now,
				now,
			);

		this.writeHistory(id, 1, specYaml, changedBy, "created");

		return {
			id,
			kind,
			name,
			version: 1,
			specYaml,
			metadata: parsedMeta,
			createdAt: now,
			updatedAt: now,
		};
	}

	get(kind: DefinitionKind, name: string): ResourceDefinition | null {
		const row = this.db
			.prepare("SELECT * FROM resource_definitions WHERE kind = ? AND name = ?")
			.get(kind, name) as Record<string, unknown> | undefined;
		return row ? rowToDefinition(row) : null;
	}

	list(kind: DefinitionKind): ResourceDefinition[] {
		const rows = this.db
			.prepare(
				"SELECT * FROM resource_definitions WHERE kind = ? ORDER BY name ASC",
			)
			.all(kind) as Record<string, unknown>[];
		return rows.map(rowToDefinition);
	}

	update(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): ResourceDefinition {
		const existing = this.get(kind, name);
		if (!existing) {
			throw new Error(`${kind} "${name}" not found`);
		}

		const now = new Date().toISOString();
		const newVersion = existing.version + 1;
		const parsedMeta = this.extractMetadata(specYaml);

		this.db
			.prepare(
				`UPDATE resource_definitions
         SET spec_yaml = ?, metadata = ?, version = ?, updated_at = ?
         WHERE kind = ? AND name = ?`,
			)
			.run(
				specYaml,
				parsedMeta ? JSON.stringify(parsedMeta) : null,
				newVersion,
				now,
				kind,
				name,
			);

		this.writeHistory(existing.id, newVersion, specYaml, changedBy, "updated");

		return {
			...existing,
			version: newVersion,
			specYaml,
			metadata: parsedMeta,
			updatedAt: now,
		};
	}

	upsert(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): ResourceDefinition {
		const existing = this.get(kind, name);
		if (existing) {
			// Byte-identical spec → no-op. Boot loops upsert every YAML on
			// every restart; without this guard each restart would bump
			// version + write a history row for every unchanged definition.
			if (existing.specYaml === specYaml) return existing;
			return this.update(kind, name, specYaml, changedBy);
		}
		try {
			return this.create(kind, name, specYaml, changedBy);
		} catch (err) {
			// Concurrent-create race (multiple processes against the same DB
			// file): SQLite raises SQLITE_CONSTRAINT_UNIQUE. Re-fetch + resolve.
			if (isSqliteUniqueViolation(err)) {
				const racy = this.get(kind, name);
				if (racy) {
					if (racy.specYaml === specYaml) return racy;
					return this.update(kind, name, specYaml, changedBy);
				}
			}
			throw err;
		}
	}

	delete(kind: DefinitionKind, name: string, changedBy: string): void {
		const existing = this.get(kind, name);
		if (!existing) {
			throw new Error(`${kind} "${name}" not found`);
		}

		this.writeHistory(
			existing.id,
			existing.version,
			existing.specYaml,
			changedBy,
			"deleted",
		);

		this.db
			.prepare("DELETE FROM resource_definitions WHERE kind = ? AND name = ?")
			.run(kind, name);
	}

	listHistory(kind: DefinitionKind, name: string): ResourceDefinitionHistory[] {
		// Find the definition ID (may still exist or may have been deleted)
		const existing = this.db
			.prepare(
				"SELECT id FROM resource_definitions WHERE kind = ? AND name = ?",
			)
			.get(kind, name) as { id: string } | undefined;

		if (existing) {
			const rows = this.db
				.prepare(
					"SELECT * FROM resource_definition_history WHERE definition_id = ? ORDER BY version ASC",
				)
				.all(existing.id) as Record<string, unknown>[];
			return rows.map(rowToHistory);
		}

		return [];
	}

	asLegacyStore(): DefinitionStore {
		return {
			addAgent: (agent) =>
				this.upsert(
					"AgentDefinition",
					agent.metadata.name,
					JSON.stringify(agent, null, 2),
					"legacy",
				),
			getAgent: (name) => {
				const def = this.get("AgentDefinition", name);
				return def ? parseSpec<AgentDefinitionYaml>(def.specYaml) : undefined;
			},
			listAgents: () =>
				this.list("AgentDefinition").map((d) =>
					parseSpec<AgentDefinitionYaml>(d.specYaml),
				),

			addPipeline: (pipeline) =>
				this.upsert(
					"PipelineDefinition",
					pipeline.metadata.name,
					JSON.stringify(pipeline, null, 2),
					"legacy",
				),
			getPipeline: (name) => {
				const def = this.get("PipelineDefinition", name);
				return def
					? parseSpec<PipelineDefinitionYaml>(def.specYaml)
					: undefined;
			},
			listPipelines: () =>
				this.list("PipelineDefinition").map((d) =>
					parseSpec<PipelineDefinitionYaml>(d.specYaml),
				),

			addNode: (node) =>
				this.upsert(
					"NodeDefinition",
					node.metadata.name,
					JSON.stringify(node, null, 2),
					"legacy",
				),
			getNode: (name) => {
				const def = this.get("NodeDefinition", name);
				return def ? parseSpec<NodeDefinitionYaml>(def.specYaml) : undefined;
			},
			listNodes: () =>
				this.list("NodeDefinition").map((d) =>
					parseSpec<NodeDefinitionYaml>(d.specYaml),
				),

			clear: () => {
				this.db.prepare("DELETE FROM resource_definitions").run();
			},
		};
	}

	close(): void {
		this.db.close();
	}

	private writeHistory(
		definitionId: string,
		version: number,
		specYaml: string,
		changedBy: string,
		changeType: ResourceDefinitionHistory["changeType"],
	): void {
		this.db
			.prepare(
				`INSERT INTO resource_definition_history (id, definition_id, version, spec_yaml, changed_by, change_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				randomUUID(),
				definitionId,
				version,
				specYaml,
				changedBy,
				changeType,
				new Date().toISOString(),
			);
	}

	private extractMetadata(
		specYaml: string,
	): Record<string, unknown> | undefined {
		try {
			const metaMatch = specYaml.match(/metadata:\s*\n((?:\s+\w+:.*\n)*)/);
			if (!metaMatch) return undefined;
			const lines = metaMatch[1].split("\n").filter((l) => l.trim());
			const meta: Record<string, unknown> = {};
			for (const line of lines) {
				const match = line.match(/^\s+(\w+):\s*(.+)/);
				if (match) meta[match[1]] = match[2].trim();
			}
			return Object.keys(meta).length > 0 ? meta : undefined;
		} catch {
			return undefined;
		}
	}
}

function isSqliteUniqueViolation(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const e = err as { code?: unknown; message?: unknown };
	return (
		e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
		e.code === "SQLITE_CONSTRAINT" ||
		(typeof e.message === "string" && e.message.includes("UNIQUE constraint"))
	);
}

function rowToDefinition(row: Record<string, unknown>): ResourceDefinition {
	const metadataRaw = row.metadata as string | null;
	return {
		id: row.id as string,
		kind: row.kind as DefinitionKind,
		name: row.name as string,
		version: row.version as number,
		specYaml: row.spec_yaml as string,
		metadata: metadataRaw
			? (JSON.parse(metadataRaw) as Record<string, unknown>)
			: undefined,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

function rowToHistory(row: Record<string, unknown>): ResourceDefinitionHistory {
	return {
		id: row.id as string,
		definitionId: row.definition_id as string,
		version: row.version as number,
		specYaml: row.spec_yaml as string,
		changedBy: row.changed_by as string,
		changeType: row.change_type as ResourceDefinitionHistory["changeType"],
		createdAt: row.created_at as string,
	};
}

function parseSpec<T>(specYaml: string): T {
	return JSON.parse(specYaml) as T;
}
