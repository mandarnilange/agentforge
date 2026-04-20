import { z } from "zod/v4";

const InterfaceSchema = z.object({
	name: z.string(),
	protocol: z.string().nullish(),
	port: z.number().nullish(),
	description: z.string().nullish(),
});

const ComponentSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	responsibility: z.string(),
	technology: z.string(),
	interfaces: z.array(InterfaceSchema).nullish(),
	dependencies: z.array(z.string()).nullish(),
	layer: z.string().nullish(),
});

const CommunicationSchema = z.object({
	from: z.string(),
	to: z.string(),
	protocol: z.string(),
	pattern: z.string().nullish(),
	description: z.string().nullish(),
});

const DataFlowSchema = z.object({
	source: z.string(),
	destination: z.string(),
	data: z.string(),
	description: z.string().nullish(),
});

export const ArchitectureSchema = z.object({
	pattern: z.string(),
	components: z.array(ComponentSchema).min(1),
	communication: z.array(CommunicationSchema).nullish(),
	dataFlow: z.array(DataFlowSchema).nullish(),
	layers: z.array(z.string()).nullish(),
	designPrinciples: z.array(z.string()).nullish(),
	constraints: z.array(z.string()).nullish(),
	notes: z.string().nullish(),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
