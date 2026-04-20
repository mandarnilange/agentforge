import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export type SSEStatus = "connected" | "connecting" | "disconnected";

interface SSEEvent {
	type: string;
	pipelineRunId?: string;
	runId?: string;
	gateId?: string;
	nodeName?: string;
}

export function useSSE(): { status: SSEStatus } {
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const [status, setStatus] = useState<SSEStatus>("connecting");

	useEffect(() => {
		const es = new EventSource("/api/v1/events");
		eventSourceRef.current = es;
		setStatus("connecting");

		es.onopen = () => {
			setStatus("connected");
		};

		es.onerror = () => {
			setStatus("disconnected");
		};

		es.onmessage = (event) => {
			let parsed: SSEEvent;
			try {
				parsed = JSON.parse(event.data) as SSEEvent;
			} catch {
				return;
			}

			switch (parsed.type) {
				case "pipeline_updated":
					queryClient.invalidateQueries({ queryKey: ["pipelines"] });
					queryClient.invalidateQueries({ queryKey: ["summary"] });
					if (parsed.pipelineRunId) {
						queryClient.invalidateQueries({
							queryKey: ["pipeline", parsed.pipelineRunId],
						});
					}
					break;

				case "run_updated":
					queryClient.invalidateQueries({ queryKey: ["pipelines"] });
					queryClient.invalidateQueries({ queryKey: ["summary"] });
					break;

				case "gate_opened":
				case "gate_decided":
					queryClient.invalidateQueries({ queryKey: ["pending-gates"] });
					queryClient.invalidateQueries({ queryKey: ["pipelines"] });
					if (parsed.pipelineRunId) {
						queryClient.invalidateQueries({
							queryKey: ["pipeline", parsed.pipelineRunId],
						});
					}
					break;

				case "node_online":
				case "node_degraded":
				case "node_offline":
					queryClient.invalidateQueries({ queryKey: ["nodes"] });
					break;
			}
		};

		return () => {
			es.close();
			eventSourceRef.current = null;
		};
	}, [queryClient]);

	return { status };
}
