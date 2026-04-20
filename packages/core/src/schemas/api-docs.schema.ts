import { z } from "zod/v4";

const EndpointSchema = z
	.object({
		method: z.string(),
		path: z.string(),
		description: z.string(),
		requestExample: z.record(z.string(), z.unknown()).optional(),
		responseExample: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export const ApiDocsSchema = z
	.object({
		endpoints: z.array(EndpointSchema).min(1),
	})
	.passthrough();

export type ApiDocs = z.infer<typeof ApiDocsSchema>;
