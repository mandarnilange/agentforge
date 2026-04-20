import { z } from "zod/v4";

const ViolationSchema = z
	.object({
		id: z.string(),
		impact: z.string(),
		description: z.string(),
		component: z.string().optional(),
	})
	.passthrough();

export const AccessibilityAuditSchema = z.object({
	wcagLevel: z.enum(["A", "AA", "AAA"]),
	violations: z.array(ViolationSchema),
	passes: z.number().int().nonnegative(),
	summary: z.string(),
});

export type AccessibilityAudit = z.infer<typeof AccessibilityAuditSchema>;
