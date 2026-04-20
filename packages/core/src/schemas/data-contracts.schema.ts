import { z } from "zod/v4";

const DataContractSchema = z
	.object({
		name: z.string(),
		producer: z.string(),
		consumer: z.string(),
		schema: z.record(z.string(), z.unknown()),
	})
	.passthrough();

export const DataContractsSchema = z.object({
	contracts: z.array(DataContractSchema).min(1),
});

export type DataContracts = z.infer<typeof DataContractsSchema>;
