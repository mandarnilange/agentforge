#!/bin/sh
set -e

CMD="${1:-dashboard}"

case "$CMD" in
  dashboard)
    echo "Starting AgentForge Platform dashboard on 0.0.0.0:${PORT:-3001}..."
    exec node packages/platform/dist/platform-cli.js dashboard --host 0.0.0.0 --port "${PORT:-3001}"
    ;;

  run)
    PROJECT="${PROJECT:-my-project}"
    PIPELINE="${PIPELINE:-simple-sdlc}"

    if [ -n "$BRIEF_FILE" ] && [ -f "$BRIEF_FILE" ]; then
      BRIEF="$(cat "$BRIEF_FILE")"
    fi

    if [ -z "$BRIEF" ]; then
      echo "ERROR: Provide BRIEF (inline text) or BRIEF_FILE (path to .txt) env var."
      exit 1
    fi

    echo "Running pipeline '${PIPELINE}' for project '${PROJECT}'..."
    exec node packages/platform/dist/platform-cli.js run \
      --project "$PROJECT" \
      --pipeline "$PIPELINE" \
      --input "brief=$BRIEF"
    ;;

  gate)
    ACTION="${GATE_ACTION:-approve}"
    if [ -z "$GATE_ID" ]; then
      echo "ERROR: GATE_ID env var is required."
      exit 1
    fi
    echo "Running gate ${ACTION} on ${GATE_ID}..."
    exec node packages/platform/dist/platform-cli.js gate "$ACTION" "$GATE_ID"
    ;;

  worker)
    if [ -z "$CONTROL_PLANE_URL" ]; then
      echo "ERROR: CONTROL_PLANE_URL env var is required for worker mode."
      exit 1
    fi
    echo "Starting worker node connecting to ${CONTROL_PLANE_URL}..."
    exec node packages/platform/dist/platform-cli.js node start \
      --control-plane-url "$CONTROL_PLANE_URL" \
      --token "${AGENTFORGE_NODE_SECRET:-}"
    ;;

  *)
    exec node packages/platform/dist/platform-cli.js "$@"
    ;;
esac
