import { z } from "zod/v4";
import type { SchemaValidator } from "./schema-validator.js";
import { ZodSchemaAdapter } from "./zod-schema-adapter.js";

export type { AccessibilityAudit } from "./accessibility-audit.schema.js";
export { AccessibilityAuditSchema } from "./accessibility-audit.schema.js";
export type { ADR } from "./adr.schema.js";
export { AdrSchema } from "./adr.schema.js";
export type { ApiCode } from "./api-code.schema.js";
export { ApiCodeSchema } from "./api-code.schema.js";
export type { ApiDocs } from "./api-docs.schema.js";
export { ApiDocsSchema } from "./api-docs.schema.js";
export type { ApiTests } from "./api-tests.schema.js";
export { ApiTestsSchema } from "./api-tests.schema.js";
export type { ArchOptions } from "./arch-options.schema.js";
export { ArchOptionsSchema } from "./arch-options.schema.js";
export type { Architecture } from "./architecture.schema.js";
export { ArchitectureSchema } from "./architecture.schema.js";
// DevOps artifacts
export type { CicdConfig } from "./cicd-config.schema.js";
export { CicdConfigSchema } from "./cicd-config.schema.js";
export type { Epic, UserStory } from "./common.schema.js";
export { EpicSchema, UserStorySchema } from "./common.schema.js";
export type { ComplianceEvidence } from "./compliance-evidence.schema.js";
export { ComplianceEvidenceSchema } from "./compliance-evidence.schema.js";
export type { ComponentDiagram } from "./component-diagram.schema.js";
export { ComponentDiagramSchema } from "./component-diagram.schema.js";
export type { ComponentDocs } from "./component-docs.schema.js";
export { ComponentDocsSchema } from "./component-docs.schema.js";
export type { CoverageReport } from "./coverage-report.schema.js";
export { CoverageReportSchema } from "./coverage-report.schema.js";
export type { DataContracts } from "./data-contracts.schema.js";
export { DataContractsSchema } from "./data-contracts.schema.js";
export type { DefectLog } from "./defect-log.schema.js";
export { DefectLogSchema } from "./defect-log.schema.js";
export type { DependencyMap } from "./dependency-map.schema.js";
export { DependencyMapSchema } from "./dependency-map.schema.js";
export type { DeploymentRisk } from "./deployment-risk.schema.js";
export { DeploymentRiskSchema } from "./deployment-risk.schema.js";
export type { DeploymentRunbook } from "./deployment-runbook.schema.js";
export { DeploymentRunbookSchema } from "./deployment-runbook.schema.js";
export type { DeploymentTopology } from "./deployment-topology.schema.js";
export { DeploymentTopologySchema } from "./deployment-topology.schema.js";
export type { DesignTokens } from "./design-tokens.schema.js";
export { DesignTokensSchema } from "./design-tokens.schema.js";
export type { DodChecklist } from "./dod-checklist.schema.js";
export { DodChecklistSchema } from "./dod-checklist.schema.js";
export type { EffortEstimate } from "./effort-estimate.schema.js";
export { EffortEstimateSchema } from "./effort-estimate.schema.js";
// Data artifacts
export type { Erd } from "./erd.schema.js";
export { ErdSchema } from "./erd.schema.js";
export type { FRD } from "./frd.schema.js";
export { FrdSchema } from "./frd.schema.js";
export type { IacTemplates } from "./iac-templates.schema.js";
export { IacTemplatesSchema } from "./iac-templates.schema.js";
export type { IndexingStrategy } from "./indexing-strategy.schema.js";
export { IndexingStrategySchema } from "./indexing-strategy.schema.js";
export type { Migrations } from "./migrations.schema.js";
export { MigrationsSchema } from "./migrations.schema.js";
export type { MonitoringConfig } from "./monitoring-config.schema.js";
export { MonitoringConfigSchema } from "./monitoring-config.schema.js";
export type { NFR } from "./nfr.schema.js";
export { NfrSchema } from "./nfr.schema.js";
export type { OpenApiSpec } from "./openapi-spec.schema.js";
export { OpenApiSpecSchema } from "./openapi-spec.schema.js";
export type { ProjectProposal } from "./project-proposal.schema.js";
export { ProjectProposalSchema } from "./project-proposal.schema.js";
export type { ReleaseReadiness } from "./release-readiness.schema.js";
export { ReleaseReadinessSchema } from "./release-readiness.schema.js";
export type { RiskRegister } from "./risk-register.schema.js";
export { RiskRegisterSchema } from "./risk-register.schema.js";
export type { SchemaDdl } from "./schema-ddl.schema.js";
export { SchemaDdlSchema } from "./schema-ddl.schema.js";
export type { SecurityBacklog } from "./security-backlog.schema.js";
export { SecurityBacklogSchema } from "./security-backlog.schema.js";
export type { SecurityDesign } from "./security-design.schema.js";
export { SecurityDesignSchema } from "./security-design.schema.js";
export type { SprintPlan } from "./sprint-plan.schema.js";
export { SprintPlanSchema } from "./sprint-plan.schema.js";
export type { TechStackRecommendation } from "./tech-stack-rec.schema.js";
export { TechStackRecSchema } from "./tech-stack-rec.schema.js";
// QA artifacts
export type { TestSuite } from "./test-suite.schema.js";
export { TestSuiteSchema } from "./test-suite.schema.js";
// Security artifacts
export type { ThreatModel } from "./threat-model.schema.js";
export { ThreatModelSchema } from "./threat-model.schema.js";
export type { Timeline } from "./timeline.schema.js";
export { TimelineSchema } from "./timeline.schema.js";
// Frontend artifacts
export type { UiComponents } from "./ui-components.schema.js";
export { UiComponentsSchema } from "./ui-components.schema.js";
export type { VulnerabilityScan } from "./vulnerability-scan.schema.js";
export { VulnerabilityScanSchema } from "./vulnerability-scan.schema.js";
export type { Wireframes } from "./wireframes.schema.js";
export { WireframesSchema } from "./wireframes.schema.js";

// -- Schema Registry --

import { AccessibilityAuditSchema } from "./accessibility-audit.schema.js";
import { AdrSchema } from "./adr.schema.js";
import { ApiCodeSchema } from "./api-code.schema.js";
import { ApiDocsSchema } from "./api-docs.schema.js";
import { ApiTestsSchema } from "./api-tests.schema.js";
import { ArchOptionsSchema } from "./arch-options.schema.js";
import { ArchitectureSchema } from "./architecture.schema.js";
import { CicdConfigSchema } from "./cicd-config.schema.js";
import { ComplianceEvidenceSchema } from "./compliance-evidence.schema.js";
import { ComponentDiagramSchema } from "./component-diagram.schema.js";
import { ComponentDocsSchema } from "./component-docs.schema.js";
import { CoverageReportSchema } from "./coverage-report.schema.js";
import { DataContractsSchema } from "./data-contracts.schema.js";
import { DefectLogSchema } from "./defect-log.schema.js";
import { DependencyMapSchema } from "./dependency-map.schema.js";
import { DeploymentRiskSchema } from "./deployment-risk.schema.js";
import { DeploymentRunbookSchema } from "./deployment-runbook.schema.js";
import { DeploymentTopologySchema } from "./deployment-topology.schema.js";
import { DesignTokensSchema } from "./design-tokens.schema.js";
import { DodChecklistSchema } from "./dod-checklist.schema.js";
import { EffortEstimateSchema } from "./effort-estimate.schema.js";
import { ErdSchema } from "./erd.schema.js";
import { FrdSchema } from "./frd.schema.js";
import { IacTemplatesSchema } from "./iac-templates.schema.js";
import { IndexingStrategySchema } from "./indexing-strategy.schema.js";
import { MigrationsSchema } from "./migrations.schema.js";
import { MonitoringConfigSchema } from "./monitoring-config.schema.js";
import { NfrSchema } from "./nfr.schema.js";
import { OpenApiSpecSchema } from "./openapi-spec.schema.js";
import { ProjectProposalSchema } from "./project-proposal.schema.js";
import { ReleaseReadinessSchema } from "./release-readiness.schema.js";
import { RiskRegisterSchema } from "./risk-register.schema.js";
import { SchemaDdlSchema } from "./schema-ddl.schema.js";
import { SecurityBacklogSchema } from "./security-backlog.schema.js";
import { SecurityDesignSchema } from "./security-design.schema.js";
import { SprintPlanSchema } from "./sprint-plan.schema.js";
import { TechStackRecSchema } from "./tech-stack-rec.schema.js";
import { TestSuiteSchema } from "./test-suite.schema.js";
import { ThreatModelSchema } from "./threat-model.schema.js";
import { TimelineSchema } from "./timeline.schema.js";
import { UiComponentsSchema } from "./ui-components.schema.js";
import { VulnerabilityScanSchema } from "./vulnerability-scan.schema.js";
import { WireframesSchema } from "./wireframes.schema.js";

const schemaRegistry: Record<string, z.ZodType> = {
	frd: FrdSchema,
	nfr: NfrSchema,
	"tech-stack-recommendation": TechStackRecSchema,
	timeline: TimelineSchema,
	"effort-estimate": EffortEstimateSchema,
	"project-proposal": ProjectProposalSchema,
	wireframes: WireframesSchema,
	"design-tokens": DesignTokensSchema,
	architecture: ArchitectureSchema,
	adr: AdrSchema,
	"deployment-topology": DeploymentTopologySchema,
	"arch-options": ArchOptionsSchema,
	"security-design": SecurityDesignSchema,
	"component-diagram": ComponentDiagramSchema,
	adrs: z.array(AdrSchema),
	"tech-stack-confirmed": TechStackRecSchema,
	"sprint-plan": SprintPlanSchema,
	"dependency-map": DependencyMapSchema,
	"risk-register": RiskRegisterSchema,
	"dod-checklist": DodChecklistSchema,
	"api-code": ApiCodeSchema,
	"openapi-spec": OpenApiSpecSchema,
	"api-tests": ApiTestsSchema,
	"api-docs": ApiDocsSchema,
	// Frontend artifacts
	"ui-components": UiComponentsSchema,
	"accessibility-audit": AccessibilityAuditSchema,
	"component-docs": ComponentDocsSchema,
	// Data artifacts
	erd: ErdSchema,
	"schema-ddl": SchemaDdlSchema,
	migrations: MigrationsSchema,
	"data-contracts": DataContractsSchema,
	"indexing-strategy": IndexingStrategySchema,
	// QA artifacts
	"test-suite": TestSuiteSchema,
	"coverage-report": CoverageReportSchema,
	"defect-log": DefectLogSchema,
	"release-readiness": ReleaseReadinessSchema,
	// Security artifacts
	"threat-model": ThreatModelSchema,
	"vulnerability-scan": VulnerabilityScanSchema,
	"compliance-evidence": ComplianceEvidenceSchema,
	"security-backlog": SecurityBacklogSchema,
	// DevOps artifacts
	"cicd-config": CicdConfigSchema,
	"deployment-runbook": DeploymentRunbookSchema,
	"iac-templates": IacTemplatesSchema,
	"monitoring-config": MonitoringConfigSchema,
	"deployment-risk": DeploymentRiskSchema,
};

export function getSchemaForType(artifactType: string): z.ZodType | undefined {
	return schemaRegistry[artifactType];
}

// --- Unified SchemaValidator registry ---
// Discovered schemas from .agentforge/schemas/ override built-in Zod schemas.

let discoveredSchemas: Map<string, SchemaValidator> = new Map();
const wrappedZodCache = new Map<string, ZodSchemaAdapter>();

export function setDiscoveredSchemas(
	schemas: Map<string, SchemaValidator>,
): void {
	discoveredSchemas = schemas;
}

export function resetDiscoveredSchemas(): void {
	discoveredSchemas = new Map();
}

/**
 * List the names of every schema currently registered (from PG, SQLite,
 * or `.agentforge/schemas/`). Names are the artifact-type keys used by
 * `getValidatorForType()`.
 */
export function listDiscoveredSchemas(): string[] {
	return [...discoveredSchemas.keys()].sort();
}

/**
 * Get a registered schema by name, returning the JSON Schema body for
 * dashboard display. Built-in Zod fallbacks aren't returned here — those
 * have no JSON Schema form to surface.
 */
export function getDiscoveredSchema(
	name: string,
): Record<string, unknown> | undefined {
	return discoveredSchemas.get(name)?.jsonSchema;
}

export function getValidatorForType(
	artifactType: string,
): SchemaValidator | undefined {
	const discovered = discoveredSchemas.get(artifactType);
	if (discovered) return discovered;

	const zodSchema = schemaRegistry[artifactType];
	if (!zodSchema) return undefined;

	let cached = wrappedZodCache.get(artifactType);
	if (!cached) {
		cached = new ZodSchemaAdapter(zodSchema);
		wrappedZodCache.set(artifactType, cached);
	}
	return cached;
}
