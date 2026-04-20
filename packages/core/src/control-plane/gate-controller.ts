/**
 * GateController — manages human approval gates.
 * Creates gates when phases complete, processes approve/reject/revise actions.
 * Writes audit trail and updates pipeline state.
 */

import type { Gate } from "../domain/models/gate.model.js";
import type { IStateStore } from "../domain/ports/state-store.port.js";

export class GateController {
	constructor(private readonly store: IStateStore) {}

	async openGate(
		pipelineRunId: string,
		phaseCompleted: number,
		phaseNext: number,
		artifactVersionIds: string[],
	): Promise<Gate> {
		// Skip if a pending or approved gate already exists for this phase transition
		const existingGates = await this.store.listGates(pipelineRunId);
		const duplicate = existingGates.find(
			(g) =>
				g.phaseCompleted === phaseCompleted &&
				g.phaseNext === phaseNext &&
				(g.status === "pending" || g.status === "approved"),
		);
		if (duplicate) {
			await this.store.updatePipelineRun(pipelineRunId, {
				status: "paused_at_gate",
			});
			return duplicate;
		}

		const gate = await this.store.createGate({
			pipelineRunId,
			phaseCompleted,
			phaseNext,
			status: "pending",
			artifactVersionIds,
		});

		await this.store.updatePipelineRun(pipelineRunId, {
			status: "paused_at_gate",
		});

		return gate;
	}

	async approve(
		gateId: string,
		reviewer?: string,
		comment?: string,
	): Promise<Gate> {
		const gate = await this.getGateOrThrow(gateId);
		this.assertPending(gate);

		await this.store.updateGate(gateId, {
			status: "approved",
			reviewer,
			comment,
			decidedAt: new Date().toISOString(),
		});

		await this.store.writeAuditLog({
			pipelineRunId: gate.pipelineRunId,
			actor: reviewer ?? "system",
			action: "approve_gate",
			resourceType: "gate",
			resourceId: gateId,
			metadata: {
				comment,
				phaseCompleted: gate.phaseCompleted,
				phaseNext: gate.phaseNext,
			},
		});

		const updated = await this.store.getGate(gateId);
		if (!updated) throw new Error(`Gate "${gateId}" not found after update`);
		return updated;
	}

	async reject(
		gateId: string,
		reviewer?: string,
		comment?: string,
	): Promise<Gate> {
		const gate = await this.getGateOrThrow(gateId);
		this.assertPending(gate);

		await this.store.updateGate(gateId, {
			status: "rejected",
			reviewer,
			comment,
			decidedAt: new Date().toISOString(),
		});

		await this.store.updatePipelineRun(gate.pipelineRunId, {
			status: "failed",
		});

		await this.store.writeAuditLog({
			pipelineRunId: gate.pipelineRunId,
			actor: reviewer ?? "system",
			action: "reject_gate",
			resourceType: "gate",
			resourceId: gateId,
			metadata: { comment },
		});

		const rejected = await this.store.getGate(gateId);
		if (!rejected) throw new Error(`Gate "${gateId}" not found after update`);
		return rejected;
	}

	async revise(
		gateId: string,
		notes: string,
		reviewer?: string,
	): Promise<Gate> {
		const gate = await this.getGateOrThrow(gateId);
		this.assertPending(gate);

		await this.store.updateGate(gateId, {
			status: "revision_requested",
			revisionNotes: notes,
			reviewer,
			decidedAt: new Date().toISOString(),
		});

		await this.store.writeAuditLog({
			pipelineRunId: gate.pipelineRunId,
			actor: reviewer ?? "system",
			action: "revise_gate",
			resourceType: "gate",
			resourceId: gateId,
			metadata: { notes },
		});

		const updated = await this.store.getGate(gateId);
		if (!updated) throw new Error(`Gate "${gateId}" not found after update`);
		return updated;
	}

	private async getGateOrThrow(gateId: string): Promise<Gate> {
		const gate = await this.store.getGate(gateId);
		if (!gate) throw new Error(`Gate "${gateId}" not found`);
		return gate;
	}

	private assertPending(gate: Gate): void {
		if (gate.status !== "pending") {
			throw new Error(
				`Gate "${gate.id}" is not pending (current status: ${gate.status})`,
			);
		}
	}
}
