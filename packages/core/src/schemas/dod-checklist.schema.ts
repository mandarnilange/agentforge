import { z } from "zod/v4";

const DodItemSchema = z.object({
	id: z.string(),
	description: z.string(),
	category: z.string().optional(),
	required: z.boolean().optional(),
	verificationMethod: z.string().optional(),
});

export const DodChecklistSchema = z.object({
	items: z.array(DodItemSchema).min(1),
	notes: z.string().optional(),
});

export type DodChecklist = z.infer<typeof DodChecklistSchema>;
