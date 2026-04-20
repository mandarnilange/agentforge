import { z } from "zod/v4";

export const AdrSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.enum(["proposed", "accepted", "deprecated", "superseded"]),
	context: z.string(),
	decision: z.string(),
	consequences: z.array(z.string()),
	date: z.string().optional(),
	alternatives: z.array(z.string()).optional(),
	relatedAdrs: z.array(z.string()).optional(),
	notes: z.string().optional(),
});

export type ADR = z.infer<typeof AdrSchema>;
