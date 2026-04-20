import { z } from "zod/v4";

const ArchOptionSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	pros: z.array(z.string()),
	cons: z.array(z.string()),
	tradeoffs: z.string(),
	estimatedCost: z.string().optional(),
	recommended: z.boolean().optional(),
	risks: z.array(z.string()).optional(),
});

const ComparisonMatrixSchema = z.object({
	criteria: z.array(z.string()),
	scores: z.record(z.string(), z.record(z.string(), z.string())),
});

export const ArchOptionsSchema = z.object({
	options: z.array(ArchOptionSchema).min(1),
	comparisonMatrix: ComparisonMatrixSchema.optional(),
	recommendation: z.string().optional(),
	notes: z.string().optional(),
});

export type ArchOptions = z.infer<typeof ArchOptionsSchema>;
