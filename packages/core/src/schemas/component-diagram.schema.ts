import { z } from "zod/v4";

export const ComponentDiagramSchema = z.object({
	format: z.string().optional(),
	content: z.string(),
	description: z.string().optional(),
});

export type ComponentDiagram = z.infer<typeof ComponentDiagramSchema>;
