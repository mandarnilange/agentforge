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
		type: z.string().optional(),
	}),
	spec: z.object({
		connection: z.object({
			type: z.string(),
			host: z.string().optional(),
			user: z.string().optional(),
			keyFile: z.string().optional(),
		}),
		capabilities: z.array(z.string()),
		resources: z
			.object({
				maxConcurrentRuns: z.number().optional(),
				maxTokensPerMinute: z.number().optional(),
			})
			.optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
});

export type NodeDefinitionYaml = z.infer<typeof NodeDefinitionSchema>;
