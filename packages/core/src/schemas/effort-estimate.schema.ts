import { z } from "zod/v4";

const PhaseEstimateSchema = z.object({
	phase: z.string(),
	personDays: z.number(),
	roles: z.array(z.string()).optional(),
	notes: z.string().optional(),
});

export const EffortEstimateSchema = z.object({
	totalPersonDays: z.number(),
	breakdown: z.array(PhaseEstimateSchema).min(1),
	assumptions: z.array(z.string()).optional(),
	risks: z.array(z.string()).optional(),
});

export type EffortEstimate = z.infer<typeof EffortEstimateSchema>;
