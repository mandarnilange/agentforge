import { z } from "zod/v4";

const ControlSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		status: z.enum(["compliant", "non-compliant", "partial", "not-applicable"]),
		evidence: z.string().optional(),
	})
	.passthrough();

export const ComplianceEvidenceSchema = z.object({
	framework: z.string(),
	controls: z.array(ControlSchema).min(1),
	overallStatus: z.enum(["compliant", "non-compliant", "partial"]),
});

export type ComplianceEvidence = z.infer<typeof ComplianceEvidenceSchema>;
