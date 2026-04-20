import { z } from "zod/v4";

const InfoSchema = z.object({
	title: z.string(),
	version: z.string(),
	description: z.string().optional(),
	contact: z.record(z.string(), z.unknown()).optional(),
	license: z.record(z.string(), z.unknown()).optional(),
});

export const OpenApiSpecSchema = z
	.object({
		openapi: z.string(),
		info: InfoSchema,
		paths: z.record(z.string(), z.record(z.string(), z.unknown())),
		components: z.record(z.string(), z.unknown()).optional(),
		servers: z.array(z.record(z.string(), z.unknown())).optional(),
		security: z.array(z.record(z.string(), z.unknown())).optional(),
		tags: z.array(z.record(z.string(), z.unknown())).optional(),
	})
	.passthrough();

export type OpenApiSpec = z.infer<typeof OpenApiSpecSchema>;
