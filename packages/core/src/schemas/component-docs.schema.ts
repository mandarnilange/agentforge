import { z } from "zod/v4";

const PropSchema = z
	.object({
		name: z.string(),
		type: z.string(),
		required: z.boolean().optional(),
		description: z.string().optional(),
	})
	.passthrough();

const ExampleSchema = z
	.object({
		title: z.string(),
		code: z.string(),
	})
	.passthrough();

const ComponentDocSchema = z
	.object({
		name: z.string(),
		description: z.string(),
		props: z.array(PropSchema),
		examples: z.array(ExampleSchema),
	})
	.passthrough();

export const ComponentDocsSchema = z.object({
	components: z.array(ComponentDocSchema).min(1),
});

export type ComponentDocs = z.infer<typeof ComponentDocsSchema>;
