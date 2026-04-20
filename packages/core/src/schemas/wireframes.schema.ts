import { z } from "zod/v4";

const ComponentSchema = z.object({
	type: z.string(),
	label: z.string().optional(),
	properties: z.record(z.string(), z.unknown()).optional(),
});

const InteractionSchema = z.object({
	trigger: z.string(),
	action: z.string(),
	target: z.string().optional(),
});

const ScreenSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	route: z.string().optional(),
	components: z.array(ComponentSchema).optional(),
	interactions: z.array(InteractionSchema).optional(),
	layout: z.string().optional(),
});

export const WireframesSchema = z.object({
	screens: z.array(ScreenSchema).min(1),
	navigationFlow: z
		.array(
			z.object({
				from: z.string(),
				to: z.string(),
				trigger: z.string().optional(),
			}),
		)
		.optional(),
});

export type Wireframes = z.infer<typeof WireframesSchema>;
