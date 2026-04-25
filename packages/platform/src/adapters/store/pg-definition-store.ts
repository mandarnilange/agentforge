/**
 * PgDefinitionStore — Postgres-backed definition storage with versioning.
 * Mirrors SqliteDefinitionStore one-for-one, but async. Used when
 * AGENTFORGE_STATE_STORE=postgres so no SQLite files are created alongside
 * a Postgres deployment.
 *
 * The runtime DefinitionStore (sync) is still an in-memory store — PG
 * serves the persistence + history role. Callers that mutate defs (YAML
 * boot loop, `apply` command) must write through to this store and await.
 */

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "agentforge-core/definitions/parser.js";
import pg from "pg";
import { applyPgMigrations } from "../../state/pg-migrate.js";

// Resolves to dist/state/migrations/postgres at runtime and
// src/state/migrations/postgres in tests/dev. Shared with PostgresStateStore
// — both stores run against the same schema_migrations track so either
// initialize() converges to a fully-migrated database.
const PG_MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"state",
	"migrations",
	"postgres",
);

export type DefinitionKind =
	| "AgentDefinition"
	| "PipelineDefinition"
	| "NodeDefinition"
	| "Schema";

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

export class PgDefinitionStore {
	private readonly pool: pg.Pool;

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async initialize(): Promise<void> {
		await applyPgMigrations(this.pool, PG_MIGRATIONS_DIR);
	}

	async preflight(): Promise<void> {
		try {
			await this.pool.query("SELECT 1");
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Postgres definition-store preflight failed: ${reason}. ` +
					"Check AGENTFORGE_POSTGRES_URL (format: postgres://user:pass@host:port/db) and that the server is reachable.",
			);
		}
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	async create(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): Promise<ResourceDefinition> {
		const now = new Date().toISOString();
		const id = randomUUID();
		const parsedMeta = extractMetadata(specYaml);

		await this.pool.query(
			`INSERT INTO resource_definitions (id, kind, name, version, spec_yaml, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
			[
				id,
				kind,
				name,
				specYaml,
				parsedMeta ? JSON.stringify(parsedMeta) : null,
				now,
				now,
			],
		);

		await this.writeHistory(id, 1, specYaml, changedBy, "created");

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

	async get(
		kind: DefinitionKind,
		name: string,
	): Promise<ResourceDefinition | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM resource_definitions WHERE kind = $1 AND name = $2",
			[kind, name],
		);
		return rows.length > 0 ? rowToDefinition(rows[0]) : null;
	}

	async list(kind: DefinitionKind): Promise<ResourceDefinition[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM resource_definitions WHERE kind = $1 ORDER BY name ASC",
			[kind],
		);
		return rows.map(rowToDefinition);
	}

	async update(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): Promise<ResourceDefinition> {
		const existing = await this.get(kind, name);
		if (!existing) {
			throw new Error(`${kind} "${name}" not found`);
		}

		const now = new Date().toISOString();
		const newVersion = existing.version + 1;
		const parsedMeta = extractMetadata(specYaml);

		await this.pool.query(
			`UPDATE resource_definitions
         SET spec_yaml = $1, metadata = $2, version = $3, updated_at = $4
         WHERE kind = $5 AND name = $6`,
			[
				specYaml,
				parsedMeta ? JSON.stringify(parsedMeta) : null,
				newVersion,
				now,
				kind,
				name,
			],
		);

		await this.writeHistory(
			existing.id,
			newVersion,
			specYaml,
			changedBy,
			"updated",
		);

		return {
			...existing,
			version: newVersion,
			specYaml,
			metadata: parsedMeta,
			updatedAt: now,
		};
	}

	async upsert(
		kind: DefinitionKind,
		name: string,
		specYaml: string,
		changedBy: string,
	): Promise<ResourceDefinition> {
		const existing = await this.get(kind, name);
		if (existing) {
			// Byte-identical spec → no-op. Boot loops upsert every YAML on
			// every restart; without this guard each restart would bump
			// version + write a history row for every unchanged definition.
			if (existing.specYaml === specYaml) return existing;
			return this.update(kind, name, specYaml, changedBy);
		}
		try {
			return await this.create(kind, name, specYaml, changedBy);
		} catch (err) {
			// Concurrent-create race: another process inserted between our
			// get() and create(). PG raises unique_violation (code 23505).
			// Re-fetch and resolve — same content → return; differs → update.
			if (isPgUniqueViolation(err)) {
				const racy = await this.get(kind, name);
				if (racy) {
					if (racy.specYaml === specYaml) return racy;
					return this.update(kind, name, specYaml, changedBy);
				}
			}
			throw err;
		}
	}

	async delete(
		kind: DefinitionKind,
		name: string,
		changedBy: string,
	): Promise<void> {
		const existing = await this.get(kind, name);
		if (!existing) {
			throw new Error(`${kind} "${name}" not found`);
		}

		await this.writeHistory(
			existing.id,
			existing.version,
			existing.specYaml,
			changedBy,
			"deleted",
		);

		await this.pool.query(
			"DELETE FROM resource_definitions WHERE kind = $1 AND name = $2",
			[kind, name],
		);
	}

	async listHistory(
		kind: DefinitionKind,
		name: string,
	): Promise<ResourceDefinitionHistory[]> {
		const existing = await this.get(kind, name);
		if (!existing) return [];
		const { rows } = await this.pool.query(
			"SELECT * FROM resource_definition_history WHERE definition_id = $1 ORDER BY version ASC",
			[existing.id],
		);
		return rows.map(rowToHistory);
	}

	// --- Convenience helpers used by platform-cli's YAML boot loop + apply ---

	async upsertAgent(
		agent: AgentDefinitionYaml,
		changedBy: string,
	): Promise<void> {
		await this.upsert(
			"AgentDefinition",
			agent.metadata.name,
			JSON.stringify(agent, null, 2),
			changedBy,
		);
	}

	async upsertPipeline(
		pipeline: PipelineDefinitionYaml,
		changedBy: string,
	): Promise<void> {
		await this.upsert(
			"PipelineDefinition",
			pipeline.metadata.name,
			JSON.stringify(pipeline, null, 2),
			changedBy,
		);
	}

	async upsertNode(node: NodeDefinitionYaml, changedBy: string): Promise<void> {
		await this.upsert(
			"NodeDefinition",
			node.metadata.name,
			JSON.stringify(node, null, 2),
			changedBy,
		);
	}

	private async writeHistory(
		definitionId: string,
		version: number,
		specYaml: string,
		changedBy: string,
		changeType: ResourceDefinitionHistory["changeType"],
	): Promise<void> {
		await this.pool.query(
			`INSERT INTO resource_definition_history (id, definition_id, version, spec_yaml, changed_by, change_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				randomUUID(),
				definitionId,
				version,
				specYaml,
				changedBy,
				changeType,
				new Date().toISOString(),
			],
		);
	}
}

function isPgUniqueViolation(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code: unknown }).code === "23505"
	);
}

function rowToDefinition(row: Record<string, unknown>): ResourceDefinition {
	// metadata is JSONB — pg returns it pre-parsed. Accept object, string, or null.
	const metaField = row.metadata;
	let metadata: Record<string, unknown> | undefined;
	if (metaField == null) {
		metadata = undefined;
	} else if (typeof metaField === "string") {
		metadata = JSON.parse(metaField) as Record<string, unknown>;
	} else {
		metadata = metaField as Record<string, unknown>;
	}
	return {
		id: row.id as string,
		kind: row.kind as DefinitionKind,
		name: row.name as string,
		version: row.version as number,
		specYaml: row.spec_yaml as string,
		metadata,
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

function extractMetadata(
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
