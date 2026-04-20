import { z } from "zod/v4";

const DefectSchema = z
	.object({
		id: z.string(),
		severity: z.enum(["critical", "high", "medium", "low"]),
		title: z.string(),
		description: z.string(),
		location: z.string().optional(),
	})
	.passthrough();

export const DefectLogSchema = z.object({
	defects: z.array(DefectSchema),
	totalDefects: z.number().int().nonnegative(),
});

export type DefectLog = z.infer<typeof DefectLogSchema>;
