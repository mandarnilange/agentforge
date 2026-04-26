import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type {
	NodeRecord,
	NodeStatus,
} from "@mandarnilange/agentforge-core/domain/models/node.model.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";

export interface NodeRegistration {
	readonly definition: NodeDefinitionYaml;
	status: NodeStatus;
	lastHeartbeat?: string;
	activeRuns: number;
}

export class NodeRegistry {
	private readonly nodes: Map<string, NodeRegistration>;
	private readonly store?: IStateStore;

	constructor(definitions: NodeDefinitionYaml[], store?: IStateStore) {
		this.store = store;
		this.nodes = new Map(
			definitions.map((def) => [
				def.metadata.name,
				{
					definition: def,
					status: "unknown" as NodeStatus,
					lastHeartbeat: undefined,
					activeRuns: 0,
				},
			]),
		);
		// Kick off async init in background
		void this.initFromStore();
	}

	private async initFromStore(): Promise<void> {
		if (!this.store) return;
		const persisted = await this.store.listNodes();
		const persistedMap = new Map(persisted.map((n) => [n.name, n]));
		for (const [name, reg] of this.nodes) {
			const existing = persistedMap.get(name);
			if (existing) {
				reg.status = existing.status;
				reg.lastHeartbeat = existing.lastHeartbeat;
				reg.activeRuns = existing.activeRuns;
			}
			void this.persist(reg);
		}
	}

	getAll(): NodeRegistration[] {
		return Array.from(this.nodes.values());
	}

	get(name: string): NodeRegistration | undefined {
		return this.nodes.get(name);
	}

	getOnline(): NodeRegistration[] {
		return this.getAll().filter((n) => n.status === "online");
	}

	markOnline(name: string): void {
		const node = this.nodes.get(name);
		if (!node) return;
		node.status = "online";
		node.lastHeartbeat = new Date().toISOString();
		void this.persist(node);
	}

	markOffline(name: string): void {
		const node = this.nodes.get(name);
		if (!node) return;
		node.status = "offline";
		void this.persist(node);
	}

	recordRunStarted(name: string): void {
		const node = this.nodes.get(name);
		if (!node) return;
		node.activeRuns += 1;
		void this.persist(node);
	}

	recordRunCompleted(name: string): void {
		const node = this.nodes.get(name);
		if (!node) return;
		node.activeRuns = Math.max(0, node.activeRuns - 1);
		void this.persist(node);
	}

	private async persist(node: NodeRegistration): Promise<void> {
		const record: NodeRecord = {
			name: node.definition.metadata.name,
			type:
				node.definition.metadata.type ??
				node.definition.spec.connection?.type ??
				"local",
			capabilities: node.definition.spec.capabilities,
			maxConcurrentRuns: node.definition.spec.resources?.maxConcurrentRuns,
			status: node.status,
			activeRuns: node.activeRuns,
			lastHeartbeat: node.lastHeartbeat,
			updatedAt: new Date().toISOString(),
		};
		await this.store?.upsertNode(record);
	}
}
