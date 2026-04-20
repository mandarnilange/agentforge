import { z } from "zod/v4";

const BacklogItemSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		priority: z.enum(["critical", "high", "medium", "low"]),
		effort: z.enum(["small", "medium", "large"]).optional(),
		description: z.string().optional(),
	})
	.passthrough();

export const SecurityBacklogSchema = z.object({
	items: z.array(BacklogItemSchema).min(1),
	totalItems: z.number().int().nonnegative(),
});

export type SecurityBacklog = z.infer<typeof SecurityBacklogSchema>;
