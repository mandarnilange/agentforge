import { z } from "zod/v4";

const ResourcesSchema = z.object({
	cpu: z.string().optional(),
	memory: z.string().optional(),
	storage: z.string().optional(),
});

const ServiceDeploymentSchema = z.object({
	name: z.string(),
	componentId: z.string().optional(),
	replicas: z.number().optional(),
	resources: ResourcesSchema.optional(),
	image: z.string().optional(),
	ports: z.array(z.number()).optional(),
	environment: z.record(z.string(), z.string()).optional(),
	healthCheck: z.string().optional(),
});

const NetworkingSchema = z.object({
	vpc: z.string().optional(),
	subnets: z.array(z.string()).optional(),
	loadBalancer: z.string().optional(),
	dns: z.string().optional(),
	firewallRules: z.array(z.string()).optional(),
});

export const DeploymentTopologySchema = z.object({
	environment: z.string(),
	services: z.array(ServiceDeploymentSchema),
	regions: z.array(z.string()).optional(),
	networking: NetworkingSchema.optional(),
	provider: z.string().optional(),
	orchestrator: z.string().optional(),
	notes: z.string().optional(),
});

export type DeploymentTopology = z.infer<typeof DeploymentTopologySchema>;
