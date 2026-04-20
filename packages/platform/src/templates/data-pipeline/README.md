# data-pipeline Template

5-agent data engineering pipeline that designs schemas, builds ETL code, validates data quality, applies business transformations, and generates cloud deployment configuration. Includes ECS node support for cloud-native execution.

## Pipeline Flow

```
[Brief] → Schema Designer → [Gate] → ETL Builder → Validator → Transformer → [Gate] → Loader → deployment-config
                                      (test loop)   (check loop) (test loop)
```

## Agents

| Agent | Executor | Input | Output | Key Feature |
|-------|----------|-------|--------|-------------|
| `schema-designer` | pi-ai | raw-brief | data-schema | Source/target schemas, quality rules, contracts |
| `etl-builder` | pi-coding-agent | data-schema | etl-code | Extract/transform/load code with test-fix loop (3x) |
| `validator` | pi-coding-agent | schema + etl-code | validation-report | Quality checks with check-fix loop (3x) |
| `transformer` | pi-coding-agent | schema + etl + validation | transform-code | Business rules, aggregations, enrichment with loop (3x) |
| `loader` | pi-ai | schema + transform + validation | deployment-config | ECS/Cloud Run/K8s deployment config + runbook |

## Quick Start

```bash
agentforge init --template data-pipeline
agentforge run-pipeline data-pipeline \
  --input brief="Source: CSV exports from Salesforce CRM (orders, accounts, contacts). Target: PostgreSQL data warehouse. Daily refresh. Cloud: AWS. Volume: ~50k records/day. Need: revenue by region, sales rep performance, customer lifetime value."
```

## Cloud Node (ECS)

The `data-pipeline` template includes an ECS Fargate node for cloud-native execution:

```bash
# Apply the ECS node (requires agentforge)
agentforge apply nodes/ecs.node.yaml

# Set required environment variables
export ECS_AGENT_ENDPOINT=https://your-ecs-endpoint
export AWS_REGION=us-east-1
export ECR_REPO=123456789.dkr.ecr.us-east-1.amazonaws.com
```

## Gates

- **After schema design**: human validates data contracts before any code is written
- **After transformation**: human validates business logic before deployment config is generated
