/**
 * OutputFormatter — formats data for CLI output in multiple modes.
 * Supports: table (default), json, yaml, wide.
 */

export type OutputFormat = "table" | "json" | "yaml" | "wide";

export interface Column {
	key: string;
	header: string;
}

export function formatOutput(
	data: unknown[] | Record<string, unknown>,
	columns: Column[],
	format: OutputFormat,
): string {
	const items = Array.isArray(data) ? data : [data];

	switch (format) {
		case "json":
			return Array.isArray(data)
				? JSON.stringify(items, null, 2)
				: JSON.stringify(data, null, 2);

		case "yaml":
			return items
				.map((item) => formatYamlItem(item as Record<string, unknown>))
				.join("---\n");

		case "wide":
			return formatTable(items as Record<string, unknown>[], columns);
		default:
			return formatTable(items as Record<string, unknown>[], columns);
	}
}

function formatTable(
	items: Record<string, unknown>[],
	columns: Column[],
): string {
	if (items.length === 0) return "No resources found";

	const widths = columns.map((col) => {
		const values = items.map((item) => String(item[col.key] ?? ""));
		return Math.max(col.header.length, ...values.map((v) => v.length));
	});

	const header = columns
		.map((col, i) => col.header.padEnd(widths[i]))
		.join("  ");

	const rows = items.map((item) =>
		columns
			.map((col, i) => String(item[col.key] ?? "").padEnd(widths[i]))
			.join("  "),
	);

	return [header, ...rows].join("\n");
}

function formatYamlItem(item: Record<string, unknown>): string {
	return `${Object.entries(item)
		.map(([key, value]) => {
			if (typeof value === "object" && value !== null) {
				return `${key}: ${JSON.stringify(value)}`;
			}
			return `${key}: ${value}`;
		})
		.join("\n")}\n`;
}
