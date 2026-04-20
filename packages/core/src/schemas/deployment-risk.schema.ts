import { z } from "zod/v4";

const RiskFactorSchema = z
	.object({
		factor: z.string(),
		impact: z.enum(["critical", "high", "medium", "low"]),
		probability: z.enum(["high", "medium", "low"]),
	})
	.passthrough();

export const DeploymentRiskSchema = z.object({
	riskScore: z.number().int().min(0).max(100),
	level: z.enum(["critical", "high", "medium", "low"]),
	factors: z.array(RiskFactorSchema),
	recommendation: z.string().optional(),
	approvalRequired: z.boolean().optional(),
});

export type DeploymentRisk = z.infer<typeof DeploymentRiskSchema>;
