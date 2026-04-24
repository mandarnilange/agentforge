#!/usr/bin/env bash
##
## Docker multi-worker smoke test.
##
## Brings up control-plane + postgres + three heterogeneous workers under
## docker compose, then asserts:
##   1. All three workers register with the control plane.
##   2. Each worker advertises the expected capabilities + concurrency cap.
##   3. Each worker heartbeats within the last 30s (lastHeartbeat is fresh).
##
## No LLM key is needed — the workers just register + idle. Nothing invokes
## the agent executor. For full pipeline validation use a real ANTHROPIC_API_KEY
## and `agentforge run` manually per docs/testing-guide.md.
##
## Usage:
##   ./packages/platform/tests/docker/multi-worker-smoke.sh
##
## Gated behind explicit invocation — not wired into `npm test` so CI doesn't
## need the Docker daemon. Requires: docker compose v2, jq, curl.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${HERE}/docker-compose.multi-worker.yml"
PROJECT="agentforge-multi-worker-smoke"
SMOKE_PORT="${SMOKE_PORT:-3099}"
WAIT_TIMEOUT_S="${WAIT_TIMEOUT_S:-120}"

if ! command -v docker >/dev/null 2>&1; then
    echo "FAIL: docker not in PATH" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "FAIL: jq not in PATH" >&2
    exit 1
fi

cleanup() {
    echo "→ tearing down compose stack"
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ starting stack (this may take a while on first run — image build)"
SMOKE_PORT="$SMOKE_PORT" docker compose -f "$COMPOSE_FILE" -p "$PROJECT" up -d --build

BASE="http://127.0.0.1:${SMOKE_PORT}"

echo "→ waiting for control plane health (${WAIT_TIMEOUT_S}s max)"
deadline=$(($(date +%s) + WAIT_TIMEOUT_S))
until curl -fsS "${BASE}/api/health" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "FAIL: control plane never became healthy" >&2
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT" logs --tail=50
        exit 1
    fi
    sleep 2
done
echo "   control plane healthy"

echo "→ waiting for all three workers to register"
deadline=$(($(date +%s) + 60))
expected_workers="worker-docker worker-gpu worker-plain"
while :; do
    nodes_json=$(curl -fsS "${BASE}/api/v1/nodes" || echo '[]')
    registered=$(echo "$nodes_json" | jq -r '.[].name' 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
    echo "   registered so far: [${registered}]"
    missing=0
    for w in $expected_workers; do
        if ! echo " $registered " | grep -q " $w "; then
            missing=1
        fi
    done
    [ "$missing" = "0" ] && break
    if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "FAIL: expected workers never all registered" >&2
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT" logs --tail=80
        exit 1
    fi
    sleep 3
done
echo "   all three workers registered"

echo "→ asserting capabilities + concurrency per worker"
check_worker() {
    local name="$1" expected_caps="$2" expected_max="$3"
    local row
    row=$(echo "$nodes_json" | jq -c --arg name "$name" '.[] | select(.name == $name)')
    if [ -z "$row" ] || [ "$row" = "null" ]; then
        echo "FAIL: $name missing from /api/v1/nodes" >&2
        exit 1
    fi
    local caps
    caps=$(echo "$row" | jq -r '.capabilities | sort | join(",")')
    local max
    max=$(echo "$row" | jq -r '.maxConcurrentRuns // "null"')
    if [ "$caps" != "$expected_caps" ]; then
        echo "FAIL: $name capabilities [$caps] != expected [$expected_caps]" >&2
        exit 1
    fi
    if [ "$max" != "$expected_max" ]; then
        echo "FAIL: $name maxConcurrentRuns=$max != expected $expected_max" >&2
        exit 1
    fi
    echo "   ok: $name caps=[$caps] max=$max"
}

# Re-fetch nodes so the row captures the post-heartbeat state
nodes_json=$(curl -fsS "${BASE}/api/v1/nodes")
check_worker worker-docker "docker,llm-access" "4"
check_worker worker-gpu "gpu,high-memory,llm-access" "2"
check_worker worker-plain "llm-access" "3"

echo "→ asserting fresh heartbeats (<30s)"
now_epoch=$(date +%s)
for w in $expected_workers; do
    hb_iso=$(echo "$nodes_json" | jq -r --arg name "$w" '.[] | select(.name == $name) | .lastHeartbeat')
    if [ -z "$hb_iso" ] || [ "$hb_iso" = "null" ]; then
        echo "FAIL: $w has no lastHeartbeat" >&2
        exit 1
    fi
    hb_epoch=$(date -u -d "$hb_iso" +%s 2>/dev/null || date -u -jf "%Y-%m-%dT%H:%M:%S.%3NZ" "$hb_iso" +%s 2>/dev/null || echo 0)
    age=$((now_epoch - hb_epoch))
    if [ "$age" -gt 30 ] || [ "$age" -lt 0 ]; then
        echo "FAIL: $w heartbeat stale (${age}s old)" >&2
        exit 1
    fi
    echo "   ok: $w heartbeat ${age}s old"
done

echo
echo "PASS: three heterogeneous workers registered, advertised correct capabilities, and heartbeated."
