import type { RendererProps } from "./registry";

interface ChecklistItem {
	id: string;
	title: string;
	description?: string;
	category?: string;
	required: boolean;
}

function humanize(s: string): string {
	return s
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChecklistRenderer({ data, filename }: RendererProps) {
	const items = (data.items ?? []) as ChecklistItem[];

	// Group by category
	const byCategory = new Map<string, ChecklistItem[]>();
	for (const item of items) {
		const cat = item.category ?? "General";
		const list = byCategory.get(cat) ?? [];
		list.push(item);
		byCategory.set(cat, list);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
				<span className="text-xs text-muted">
					{items.length} items &middot; {items.filter((i) => i.required).length}{" "}
					required
				</span>
			</div>

			{[...byCategory.entries()].map(([category, catItems]) => (
				<div key={category}>
					<div className="mb-2 text-sm font-semibold">{humanize(category)}</div>
					<div className="space-y-1">
						{catItems.map((item) => (
							<div
								key={item.id}
								className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2"
							>
								<span className="mt-0.5 text-sm text-muted">☐</span>
								<div className="flex-1">
									<div className="flex items-center gap-2 text-sm">
										<span>{item.title}</span>
										{item.required && (
											<span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-medium text-warn">
												required
											</span>
										)}
									</div>
									{item.description && (
										<p className="mt-0.5 text-xs text-muted">
											{item.description}
										</p>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
