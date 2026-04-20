import { z } from "zod/v4";

const CodeFileSchema = z
	.object({
		path: z.string(),
		language: z.string(),
		description: z.string(),
	})
	.passthrough();

export const ApiCodeSchema = z.object({
	files: z.array(CodeFileSchema).min(1),
	commitSha: z.string().nullable().optional(),
	framework: z.string(),
	entrypoint: z.string(),
});

export type ApiCode = z.infer<typeof ApiCodeSchema>;
