# Deployment Topology

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Management Host                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  PostgreSQL   │  │    Jaeger     │  │   Grafana    │  │
│  │  (state)      │  │  (tracing)   │  │ (dashboards) │  │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  │
│         │                                                │
│  ┌──────┴───────────────────────────────────────────┐   │
│  │            Control Plane (Dashboard + API)        │   │
│  │                Port 3001                          │   │
│  └──────────────────────┬───────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTP API
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────┴──────┐  ┌───────┴──────┐  ┌───────┴──────┐
│  Worker #1   │  │  Worker #2   │  │  Worker #N   │
│  (execution) │  │  (execution) │  │  (execution) │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Components

### Control Plane
- **Dashboard + API**: HTTP server on port 3001
- **PostgreSQL**: State store for pipelines, agent runs, gates, nodes
- **Jaeger**: Distributed tracing (OTLP on port 4318, UI on port 16686)
- **Grafana**: Observability dashboards (port 3000)

### Worker Nodes
- Execute agent runs (LLM calls, code generation)
- Self-register with control plane via `/api/v1/nodes/register`
- Send heartbeats every 15s
- Poll for pending work every 5s
- Can be deployed on any host with network access to control plane

## Network Requirements

| Source | Destination | Port | Protocol | Purpose |
|--------|-------------|------|----------|---------|
| Worker | Control Plane | 3001 | HTTP | Registration, heartbeat, work polling |
| Control Plane | PostgreSQL | 5432 | TCP | State store |
| Control Plane | Jaeger | 4318 | HTTP | OTLP traces |
| Worker | Jaeger | 4318 | HTTP | OTLP traces (optional) |
| Browser | Control Plane | 3001 | HTTP | Dashboard UI |
| Browser | Jaeger | 16686 | HTTP | Trace viewer |
| Browser | Grafana | 3000 | HTTP | Dashboards |

## Deployment Files

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | All-in-one deployment (single host) |
| `docker-compose.control-plane.yml` | Control plane only (management host) |
| `docker-compose.worker.yml` | Worker node only (execution host) |

## Scaling

### Adding Workers
```bash
# On a new execution host:
CONTROL_PLANE_URL=http://cp-host:3001 \
AGENTFORGE_NODE_SECRET=<shared-secret> \
docker compose -f docker-compose.worker.yml up -d

# Scale replicas on same host:
WORKER_REPLICAS=3 docker compose -f docker-compose.worker.yml up -d
```

### Removing Workers
Workers can be removed at any time. The control plane detects offline workers
via missed heartbeats (>120s) and fails their running agent runs.

```bash
docker compose -f docker-compose.worker.yml down
```

## Security

### Node Authentication
Set `AGENTFORGE_NODE_SECRET` on both control plane and workers. Workers include the
secret in the `Authorization: Bearer <secret>` header on all API calls.

If `AGENTFORGE_NODE_SECRET` is empty or unset, authentication is disabled (development mode).
