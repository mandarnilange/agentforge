import { z } from "zod/v4";

const RiskSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().optional(),
	likelihood: z.enum(["low", "medium", "high"]),
	impact: z.enum(["low", "medium", "high"]),
	mitigation: z.string(),
	owner: z.string().optional(),
	status: z.enum(["open", "mitigated", "accepted"]).optional(),
	category: z.string().optional(),
	triggerCondition: z.string().optional(),
	contingencyPlan: z.string().optional(),
});

export const RiskRegisterSchema = z.object({
	risks: z.array(RiskSchema).min(1),
	notes: z.string().optional(),
});

export type RiskRegister = z.infer<typeof RiskRegisterSchema>;
