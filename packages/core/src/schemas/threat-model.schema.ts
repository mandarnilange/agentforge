import { z } from "zod/v4";

const ThreatSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		category: z.string(),
		severity: z.enum(["critical", "high", "medium", "low"]),
		description: z.string(),
		mitigation: z.string(),
	})
	.passthrough();

export const ThreatModelSchema = z.object({
	threats: z.array(ThreatSchema).min(1),
	dataFlows: z.array(z.record(z.string(), z.unknown())),
	trustBoundaries: z.array(z.record(z.string(), z.unknown())),
});

export type ThreatModel = z.infer<typeof ThreatModelSchema>;
