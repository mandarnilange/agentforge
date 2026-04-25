/**
 * Domain schema for NodeDefinition YAML.
 * Only external dependency is zod (allowed for domain schemas).
 */

import { z } from "zod";

export const NodeDefinitionSchema = z.object({
	apiVersion: z.string(),
	kind: z.literal("NodeDefinition"),
	metadata: z.object({
		name: z.string(),
		displayName: z.string().optional(),
		description: z.string().optional(),
		// Free-form node category (local, docker, remote, ecs, …) — used by
		// templates and the scheduler. Bundled YAML often duplicates this
		// under `spec.type`; both are tolerated, neither is required.
		type: z.string().optional(),
	}),
	spec: z.object({
		// `connection` is required only for nodes the control plane has to
		// reach (SSH, HTTP-pulled remote). Local nodes and worker-self-
		// registering nodes don't need it — keep optional to match the
		// shape of the registration payload sent by `agentforge node start`
		// and the bundled templates.
		connection: z
			.object({
				type: z.string(),
				host: z.string().optional(),
				user: z.string().optional(),
				keyFile: z.string().optional(),
				endpoint: z.string().optional(),
				auth: z.unknown().optional(),
			})
			.optional(),
		// Mirrors metadata.type; either may carry the category for the
		// scheduler. Bundled templates use spec.type today.
		type: z.string().optional(),
		capabilities: z.array(z.string()),
		// Optional template knobs (image / resources etc.) — schema is
		// permissive on extra fields so authors can add provider-specific
		// hints without a schema bump.
		image: z.string().optional(),
		resources: z
			.object({
				maxConcurrentRuns: z.number().optional(),
				maxTokensPerMinute: z.number().optional(),
				memory: z.string().optional(),
				cpu: z.union([z.string(), z.number()]).optional(),
			})
			.optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
});

export type NodeDefinitionYaml = z.infer<typeof NodeDefinitionSchema>;
