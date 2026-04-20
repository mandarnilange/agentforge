/**
 * IArtifactStore — port for persisting and retrieving artifacts.
 * ZERO external dependencies.
 */

import type {
	ArtifactData,
	ArtifactMetadata,
	ArtifactQuery,
	SavedArtifact,
} from "../models/artifact.model.js";

export interface IArtifactStore {
	save(artifact: ArtifactData, outputDir: string): Promise<SavedArtifact>;
	load(query: ArtifactQuery): Promise<ArtifactData[]>;
	list(dir: string): Promise<ArtifactMetadata[]>;
}
