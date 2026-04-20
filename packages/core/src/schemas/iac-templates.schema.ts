import { z } from "zod/v4";

const IacFileSchema = z
	.object({
		path: z.string(),
		description: z.string(),
		content: z.string(),
	})
	.passthrough();

export const IacTemplatesSchema = z.object({
	tool: z.string(),
	files: z.array(IacFileSchema).min(1),
});

export type IacTemplates = z.infer<typeof IacTemplatesSchema>;
