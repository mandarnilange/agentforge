import { z } from "zod/v4";

const ComponentFileSchema = z
	.object({
		path: z.string(),
		language: z.string(),
		description: z.string(),
	})
	.passthrough();

const UiComponentSchema = z
	.object({
		name: z.string(),
		framework: z.string(),
		files: z.array(ComponentFileSchema).min(1),
	})
	.passthrough();

export const UiComponentsSchema = z.object({
	components: z.array(UiComponentSchema).min(1),
	framework: z.string(),
	designSystemVersion: z.string().optional(),
});

export type UiComponents = z.infer<typeof UiComponentsSchema>;
