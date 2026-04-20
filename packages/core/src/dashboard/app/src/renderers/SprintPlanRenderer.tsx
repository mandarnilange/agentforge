import type { RendererProps } from "./registry";

interface Task {
	id: string;
	title: string;
	estimateHours?: number;
	status?: string;
}

interface Story {
	id: string;
	title: string;
	storyPoints?: number;
	priority?: string;
	tasks?: Task[];
}

interface Sprint {
	id: string;
	name: string;
	goal?: string;
	stories?: Story[];
}

const priorityColors: Record<string, string> = {
	critical: "bg-bad/20 text-bad",
	high: "bg-bad/10 text-bad",
	medium: "bg-warn/20 text-warn",
	low: "bg-good/10 text-good",
};

const statusColors: Record<string, string> = {
	done: "text-good",
	"in-progress": "text-warn",
	pending: "text-muted",
};

export function SprintPlanRenderer({ data, filename }: RendererProps) {
	const projectName = data.projectName as string | undefined;
	const sprintDuration = data.sprintDuration as string | undefined;
	const totalPoints = data.totalStoryPoints as number | undefined;
	const sprints = (data.sprints ?? []) as Sprint[];

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
			</div>

			{/* Summary bar */}
			<div className="flex flex-wrap gap-4 text-sm">
				{projectName && (
					<div>
						<span className="text-muted">Project:</span>{" "}
						<span className="font-medium">{projectName}</span>
					</div>
				)}
				{sprintDuration && (
					<div>
						<span className="text-muted">Sprint Duration:</span>{" "}
						<span className="font-medium">{sprintDuration}</span>
					</div>
				)}
				{totalPoints != null && (
					<div>
						<span className="text-muted">Total Points:</span>{" "}
						<span className="font-medium">{totalPoints}</span>
					</div>
				)}
			</div>

			{/* Sprints */}
			{sprints.map((sprint) => (
				<div
					key={sprint.id}
					className="rounded-lg border border-border bg-panel"
				>
					<div className="border-b border-border px-4 py-3">
						<div className="font-medium">{sprint.name}</div>
						{sprint.goal && (
							<div className="mt-0.5 text-xs text-muted">{sprint.goal}</div>
						)}
					</div>

					{sprint.stories && sprint.stories.length > 0 && (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-border text-left text-xs text-muted">
									<th className="px-4 py-2 font-medium">ID</th>
									<th className="px-4 py-2 font-medium">Story</th>
									<th className="px-4 py-2 font-medium">Points</th>
									<th className="px-4 py-2 font-medium">Priority</th>
								</tr>
							</thead>
							<tbody>
								{sprint.stories.map((story) => (
									<tr
										key={story.id}
										className="border-b border-border last:border-b-0"
									>
										<td className="px-4 py-2 font-mono text-xs text-muted">
											{story.id}
										</td>
										<td className="px-4 py-2">
											<div>{story.title}</div>
											{story.tasks && story.tasks.length > 0 && (
												<div className="mt-1.5 space-y-1 pl-3 border-l border-border">
													{story.tasks.map((task) => (
														<div
															key={task.id}
															className="flex items-center gap-2 text-xs"
														>
															<span
																className={
																	statusColors[task.status ?? ""] ??
																	"text-muted"
																}
															>
																{task.status === "done" ? "✓" : "○"}
															</span>
															<span>{task.title}</span>
															{task.estimateHours != null && (
																<span className="text-muted">
																	{task.estimateHours}h
																</span>
															)}
														</div>
													))}
												</div>
											)}
										</td>
										<td className="px-4 py-2 font-mono text-xs">
											{story.storyPoints ?? "—"}
										</td>
										<td className="px-4 py-2">
											{story.priority && (
												<span
													className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${priorityColors[story.priority] ?? "bg-border text-muted"}`}
												>
													{story.priority}
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			))}
		</div>
	);
}
