import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { usePipelineDefinitions } from "../api/hooks";

interface Props {
	open: boolean;
	onClose: () => void;
}

export function NewPipelineModal({ open, onClose }: Props) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: definitions } = usePipelineDefinitions();
	const [selectedDef, setSelectedDef] = useState("");
	const [projectName, setProjectName] = useState("");
	const [inputs, setInputs] = useState<Record<string, string>>({});
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	if (!open) return null;

	const currentDef = definitions?.find((d) => d.name === selectedDef);

	const handleSubmit = async () => {
		if (!selectedDef || !projectName.trim()) {
			setError("Pipeline definition and project name are required");
			return;
		}

		setSubmitting(true);
		setError("");
		try {
			const body: Record<string, string> = {
				definition: selectedDef,
				projectName: projectName.trim(),
				...inputs,
			};
			const run = await api.createPipeline(body);
			await queryClient.invalidateQueries({ queryKey: ["pipelines"] });
			await queryClient.invalidateQueries({ queryKey: ["summary"] });
			onClose();
			navigate(`/pipelines/${run.id}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg border border-border bg-bg p-6">
				<h2 className="text-lg font-semibold">New Pipeline</h2>

				{/* Pipeline definition */}
				<label className="mt-4 block">
					<span className="text-xs font-medium text-muted">
						Pipeline Definition
					</span>
					<select
						value={selectedDef}
						onChange={(e) => {
							setSelectedDef(e.target.value);
							setInputs({});
						}}
						className="mt-1 block w-full rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-link"
					>
						<option value="">Select a pipeline...</option>
						{definitions?.map((d) => (
							<option key={d.name} value={d.name}>
								{d.displayName}
							</option>
						))}
					</select>
					{currentDef?.description && (
						<p className="mt-1 text-xs text-muted">{currentDef.description}</p>
					)}
				</label>

				{/* Project name */}
				<label className="mt-3 block">
					<span className="text-xs font-medium text-muted">Project Name</span>
					<input
						type="text"
						value={projectName}
						onChange={(e) => setProjectName(e.target.value)}
						placeholder="my-project"
						className="mt-1 block w-full rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-link"
					/>
				</label>

				{/* Dynamic inputs */}
				{currentDef?.inputs.map((input) => (
					<label key={input.name} className="mt-3 block">
						<span className="text-xs font-medium text-muted">
							{input.name}
							{input.required && <span className="ml-1 text-bad">*</span>}
						</span>
						{input.description && (
							<p className="text-[10px] text-muted">{input.description}</p>
						)}
						<textarea
							value={inputs[input.name] ?? ""}
							onChange={(e) =>
								setInputs({ ...inputs, [input.name]: e.target.value })
							}
							rows={3}
							placeholder={input.description ?? input.name}
							className="mt-1 w-full rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-link"
						/>
					</label>
				))}

				{/* Error */}
				{error && (
					<div className="mt-3 rounded border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">
						{error}
					</div>
				)}

				{/* Actions */}
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded border border-border px-4 py-2 text-sm text-muted hover:bg-white/[0.05]"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={submitting || !selectedDef || !projectName.trim()}
						className="rounded bg-link px-4 py-2 text-sm font-medium text-white hover:bg-link/80 disabled:opacity-50"
					>
						{submitting ? "Starting..." : "Start Pipeline"}
					</button>
				</div>
			</div>
		</div>
	);
}
