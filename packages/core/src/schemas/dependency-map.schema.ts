import { z } from "zod/v4";

const NodeSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string().optional(),
	team: z.string().optional(),
	description: z.string().optional(),
});

const EdgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	type: z.enum(["blocks", "needs", "feeds"]),
	description: z.string().optional(),
	critical: z.boolean().optional(),
});

export const DependencyMapSchema = z.object({
	nodes: z.array(NodeSchema).min(1),
	edges: z.array(EdgeSchema).min(1),
	criticalPath: z.array(z.string()).optional(),
	notes: z.string().optional(),
});

export type DependencyMap = z.infer<typeof DependencyMapSchema>;
