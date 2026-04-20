import { z } from "zod/v4";

const CriterionSchema = z
	.object({
		name: z.string(),
		met: z.boolean(),
	})
	.passthrough();

export const ReleaseReadinessSchema = z.object({
	ready: z.boolean(),
	score: z.number().int().min(0).max(100),
	criteria: z.array(CriterionSchema),
	blockers: z.array(z.string()),
	recommendation: z.string().optional(),
});

export type ReleaseReadiness = z.infer<typeof ReleaseReadinessSchema>;
