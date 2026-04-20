import type { RendererProps } from "./registry";

/** Convert camelCase / snake_case keys to readable headings */
function humanize(key: string): string {
	return key
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

const BADGE_KEYS = new Set([
	"status",
	"severity",
	"priority",
	"likelihood",
	"impact",
]);

const badgeColors: Record<string, string> = {
	critical: "bg-bad/20 text-bad",
	high: "bg-bad/10 text-bad",
	medium: "bg-warn/20 text-warn",
	low: "bg-good/10 text-good",
	info: "bg-link/10 text-link",
};

function Badge({ value }: { value: string }) {
	const color = badgeColors[value] ?? "bg-border text-muted";
	return (
		<span
			className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${color}`}
		>
			{value}
		</span>
	);
}

function ValueDisplay({
	keyName,
	value,
	depth,
}: {
	keyName: string;
	value: unknown;
	depth: number;
}) {
	if (value === null || value === undefined) {
		return (
			<div className="mb-3">
				<Heading depth={depth}>{humanize(keyName)}</Heading>
				<span className="text-xs italic text-muted">—</span>
			</div>
		);
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		const isBadge = BADGE_KEYS.has(keyName) && typeof value === "string";
		return (
			<div className="mb-3">
				<Heading depth={depth}>{humanize(keyName)}</Heading>
				{isBadge ? (
					<Badge value={value} />
				) : (
					<p className="text-sm">{String(value)}</p>
				)}
			</div>
		);
	}

	if (Array.isArray(value)) {
		return (
			<div className="mb-4">
				<Heading depth={depth}>{humanize(keyName)}</Heading>
				<ArraySection items={value} depth={depth} />
			</div>
		);
	}

	if (typeof value === "object") {
		return (
			<div className="mb-4">
				<Heading depth={depth}>{humanize(keyName)}</Heading>
				<ObjectSection
					data={value as Record<string, unknown>}
					depth={depth + 1}
				/>
			</div>
		);
	}

	return null;
}

function Heading({
	depth,
	children,
}: {
	depth: number;
	children: React.ReactNode;
}) {
	const classes = [
		"text-base font-semibold mb-1",
		"text-sm font-semibold text-muted mb-0.5",
		"text-xs font-medium text-muted mb-0.5",
	];
	const cls = classes[Math.min(depth, classes.length - 1)];
	return <div className={cls}>{children}</div>;
}

function ArraySection({ items, depth }: { items: unknown[]; depth: number }) {
	if (items.length === 0) {
		return <p className="text-xs italic text-muted">None</p>;
	}

	// Array of strings → bullet list
	if (items.every((i) => typeof i === "string")) {
		return (
			<ul className="list-inside list-disc space-y-0.5 pl-1 text-sm">
				{(items as string[]).map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		);
	}

	// Array of objects → card list
	if (items.every((i) => typeof i === "object" && i !== null)) {
		return (
			<div className="space-y-2">
				{(items as Record<string, unknown>[]).map((item, i) => (
					<ObjectCard key={getCardKey(item, i)} data={item} depth={depth} />
				))}
			</div>
		);
	}

	// Mixed array → simple list
	return (
		<ul className="list-inside list-disc space-y-0.5 pl-1 text-sm">
			{items.map((item) => (
				<li key={String(item)}>{String(item)}</li>
			))}
		</ul>
	);
}

function getCardKey(obj: Record<string, unknown>, fallback: number): string {
	if (typeof obj.id === "string" || typeof obj.id === "number")
		return String(obj.id);
	if (typeof obj.name === "string") return obj.name;
	return String(fallback);
}

function getCardTitle(obj: Record<string, unknown>): string | null {
	if (typeof obj.title === "string") return obj.title;
	if (typeof obj.name === "string") return obj.name;
	return null;
}

function ObjectCard({
	data,
	depth,
}: {
	data: Record<string, unknown>;
	depth: number;
}) {
	const title = getCardTitle(data);
	const id =
		typeof data.id === "string" || typeof data.id === "number"
			? String(data.id)
			: null;
	const description =
		typeof data.description === "string" ? data.description : null;

	// Fields already shown in the card header
	const headerKeys = new Set(["id", "title", "name", "description"]);
	const remainingKeys = Object.keys(data).filter((k) => !headerKeys.has(k));

	return (
		<div className="rounded-md border border-border bg-panel px-3 py-2.5">
			{/* Card header */}
			<div className="flex items-center gap-2">
				{id && <span className="font-mono text-[11px] text-muted">{id}</span>}
				{title && <span className="text-sm font-medium">{title}</span>}
			</div>
			{description && (
				<p className="mt-0.5 text-xs text-muted">{description}</p>
			)}

			{/* Remaining fields */}
			{remainingKeys.length > 0 && (
				<div className="mt-2 space-y-1">
					{remainingKeys.map((key) => (
						<ValueDisplay
							key={key}
							keyName={key}
							value={data[key]}
							depth={depth + 1}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ObjectSection({
	data,
	depth,
}: {
	data: Record<string, unknown>;
	depth: number;
}) {
	const keys = Object.keys(data);
	if (keys.length === 0) {
		return <p className="text-xs italic text-muted">Empty</p>;
	}
	return (
		<div className={depth > 1 ? "pl-3 border-l border-border" : ""}>
			{keys.map((key) => (
				<ValueDisplay key={key} keyName={key} value={data[key]} depth={depth} />
			))}
		</div>
	);
}

export function DocumentRenderer({ data, filename }: RendererProps) {
	const keys = Object.keys(data);

	if (keys.length === 0) {
		return (
			<div className="py-4 text-center text-sm text-muted">No content</div>
		);
	}

	return (
		<div className="space-y-1">
			<div className="mb-4 flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
			</div>
			{keys.map((key) => (
				<ValueDisplay key={key} keyName={key} value={data[key]} depth={0} />
			))}
		</div>
	);
}
