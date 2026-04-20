# Operational Runbooks

## Upgrading the Control Plane

1. Pull latest image or rebuild:
   ```bash
   docker compose -f docker-compose.control-plane.yml build control-plane
   ```

2. Rolling restart (zero-downtime for workers — they retry on connection failure):
   ```bash
   docker compose -f docker-compose.control-plane.yml up -d control-plane
   ```

3. Verify health:
   ```bash
   curl http://localhost:3001/api/health
   ```

4. Workers automatically reconnect after control plane restarts.
   Active pipelines are rehydrated from the database on startup.

## Adding a New Worker Node

1. Ensure the worker host has network access to the control plane (port 3001).

2. Copy `docker-compose.worker.yml` and `.env.prod` to the worker host.

3. Set required environment variables:
   ```bash
   export CONTROL_PLANE_URL=http://cp-host:3001
   export AGENTFORGE_NODE_SECRET=<shared-secret>
   export ANTHROPIC_API_KEY=<api-key>
   ```

4. Start the worker:
   ```bash
   docker compose -f docker-compose.worker.yml up -d
   ```

5. Verify registration in the dashboard (Nodes page) or via API:
   ```bash
   curl http://cp-host:3001/api/v1/nodes
   ```

## Rotating Secrets

### Node Secret
1. Update `AGENTFORGE_NODE_SECRET` on the control plane:
   ```bash
   docker compose -f docker-compose.control-plane.yml up -d control-plane
   ```

2. Update `AGENTFORGE_NODE_SECRET` on each worker and restart:
   ```bash
   docker compose -f docker-compose.worker.yml up -d
   ```

### API Key
Update `ANTHROPIC_API_KEY` on control plane and all workers, then restart each.

### PostgreSQL Password
1. Update PostgreSQL password in the database.
2. Update `POSTGRES_PASSWORD` and `AGENTFORGE_POSTGRES_URL` on the control plane.
3. Restart the control plane.

## Database Backup and Restore

### Backup
```bash
docker compose -f docker-compose.control-plane.yml exec postgres \
  pg_dump -U sdlc sdlc_agent > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore
```bash
docker compose -f docker-compose.control-plane.yml exec -T postgres \
  psql -U sdlc sdlc_agent < backup_20260409_120000.sql
```

## Disaster Recovery

### Control Plane Failure
1. If the control plane crashes, workers continue their current work.
2. Workers that complete work will retry reporting results until the control plane recovers.
3. On restart, the control plane rehydrates active pipelines from PostgreSQL.
4. The reconciliation loop detects stuck runs and retries them (up to 2 retries).

### Worker Failure
1. The control plane detects offline workers via missed heartbeats (>120s).
2. Running agent runs on the failed worker are marked as failed.
3. The reconciliation loop retries failed runs on available workers.
4. Deploy a replacement worker or scale up existing workers.

### Database Failure
1. The control plane becomes read-only (API returns errors for writes).
2. Restore from backup or fix the PostgreSQL instance.
3. Restart the control plane to reconnect.

## Monitoring

### Health Checks
- Control Plane: `GET /api/health` returns `{"status":"ok","uptime":...}`
- PostgreSQL: `pg_isready -U sdlc -d sdlc_agent`
- Jaeger: `GET http://localhost:14269/` (internal health)

### Key Metrics (via Jaeger/Grafana)
- Agent run duration by agent type
- Token usage per pipeline
- Cost per pipeline
- Error rates by agent
- Node health transitions
