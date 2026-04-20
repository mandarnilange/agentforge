/**
 * Domain types for artifacts — the primary data flowing between agents.
 * ZERO external dependencies.
 */

/** All recognized artifact types in the SDLC pipeline. */
export type ArtifactType =
	| "code"
	| "test"
	| "spec"
	| "config"
	| "documentation"
	| "diagram"
	| "report"
	| "prompt"
	| "other";

/** The core artifact payload produced or consumed by agents. */
export interface ArtifactData {
	readonly type: ArtifactType;
	readonly path: string;
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
}

/** Lightweight metadata about a stored artifact (no content). */
export interface ArtifactMetadata {
	readonly path: string;
	readonly type: ArtifactType;
	readonly size: number;
	readonly createdAt: string;
}

/** A persisted artifact with its resolved absolute path on disk. */
export interface SavedArtifact extends ArtifactMetadata {
	readonly absolutePath: string;
}

/** Query parameters for searching stored artifacts. */
export interface ArtifactQuery {
	readonly type?: ArtifactType;
	readonly pathPattern?: string;
}
