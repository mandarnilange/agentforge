import type { RendererProps } from "./registry";

interface Attribute {
	name: string;
	type: string;
	primaryKey?: boolean;
	nullable?: boolean;
}

interface Entity {
	name: string;
	attributes: Attribute[];
}

interface Relationship {
	from: string;
	to: string;
	cardinality: string;
}

export function ErdRenderer({ data, filename }: RendererProps) {
	const entities = (data.entities ?? []) as Entity[];
	const relationships = (data.relationships ?? []) as Relationship[];

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
				<span className="text-xs text-muted">
					{entities.length} entities &middot; {relationships.length}{" "}
					relationships
				</span>
			</div>

			{/* Entity cards */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{entities.map((entity) => (
					<div
						key={entity.name}
						className="rounded-lg border border-border bg-panel"
					>
						<div className="border-b border-border bg-link/5 px-3 py-2 text-sm font-semibold">
							{entity.name}
						</div>
						<table className="w-full text-xs">
							<tbody>
								{entity.attributes.map((attr) => (
									<tr
										key={attr.name}
										className="border-b border-border last:border-b-0"
									>
										<td className="px-3 py-1.5">
											<div className="flex items-center gap-1.5">
												{attr.primaryKey && (
													<span className="rounded bg-warn/20 px-1 py-0.5 text-[10px] font-bold text-warn">
														PK
													</span>
												)}
												<span className="font-medium">{attr.name}</span>
											</div>
										</td>
										<td className="px-3 py-1.5 font-mono text-muted">
											{attr.type}
										</td>
										<td className="px-3 py-1.5 text-muted">
											{attr.nullable ? "NULL" : "NOT NULL"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				))}
			</div>

			{/* Relationships */}
			{relationships.length > 0 && (
				<div>
					<div className="mb-2 text-sm font-semibold">Relationships</div>
					<div className="space-y-1">
						{relationships.map((rel) => (
							<div
								key={`${rel.from}-${rel.to}`}
								className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"
							>
								<span className="font-medium">{rel.from}</span>
								<span className="text-muted">→</span>
								<span className="font-medium">{rel.to}</span>
								<span className="ml-auto rounded bg-link/10 px-1.5 py-0.5 text-[11px] font-medium text-link">
									{rel.cardinality}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
