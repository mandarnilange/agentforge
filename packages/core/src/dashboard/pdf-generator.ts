import PDFDocument from "pdfkit";

const COLORS = {
	heading: "#1a1a2e" as const,
	subheading: "#444" as const,
	muted: "#888" as const,
	badge: {
		critical: "#dc2626",
		high: "#ea580c",
		medium: "#ca8a04",
		low: "#16a34a",
	} as Record<string, string>,
};

const MARGIN_LEFT = 40;
const INDENT = 15;

function humanize(key: string): string {
	return key
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(
	doc: InstanceType<typeof PDFDocument>,
	key: string,
	value: unknown,
	depth: number,
): void {
	const x = MARGIN_LEFT + depth * INDENT;

	if (value === null || value === undefined) return;

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		const label = humanize(key);
		doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, x, undefined, {
			continued: true,
		});
		const color = COLORS.badge[String(value)] ?? "#000";
		doc.font("Helvetica").fillColor(color).text(String(value));
		doc.fillColor("#000");
		doc.moveDown(0.3);
		return;
	}

	if (Array.isArray(value)) {
		doc
			.font("Helvetica-Bold")
			.fontSize(depth === 0 ? 12 : 10)
			.fillColor(depth === 0 ? COLORS.heading : COLORS.subheading)
			.text(humanize(key), x);
		doc.fillColor("#000").moveDown(0.2);

		if (value.length === 0) {
			doc
				.font("Helvetica-Oblique")
				.fontSize(9)
				.fillColor(COLORS.muted)
				.text("None", x + INDENT);
			doc.fillColor("#000").moveDown(0.3);
			return;
		}

		if (value.every((i) => typeof i === "string")) {
			for (const item of value as string[]) {
				doc
					.font("Helvetica")
					.fontSize(9)
					.text(`• ${item}`, x + INDENT, undefined, {
						width: 500 - depth * INDENT,
					});
			}
			doc.moveDown(0.3);
			return;
		}

		if (value.every((i) => typeof i === "object" && i !== null)) {
			for (const obj of value as Record<string, unknown>[]) {
				renderObject(doc, obj, depth + 1);
				doc.moveDown(0.2);
			}
			return;
		}

		for (const item of value) {
			doc
				.font("Helvetica")
				.fontSize(9)
				.text(`• ${String(item)}`, x + INDENT);
		}
		doc.moveDown(0.3);
		return;
	}

	if (typeof value === "object") {
		doc
			.font("Helvetica-Bold")
			.fontSize(depth === 0 ? 12 : 10)
			.fillColor(depth === 0 ? COLORS.heading : COLORS.subheading)
			.text(humanize(key), x);
		doc.fillColor("#000").moveDown(0.2);
		renderObject(doc, value as Record<string, unknown>, depth + 1);
		return;
	}
}

function renderObject(
	doc: InstanceType<typeof PDFDocument>,
	data: Record<string, unknown>,
	depth: number,
): void {
	const x = MARGIN_LEFT + depth * INDENT;

	// Title / name / id header
	const title =
		(data.title as string | undefined) ?? (data.name as string | undefined);
	const id = data.id as string | undefined;

	if (title || id) {
		const header: string[] = [];
		if (id) header.push(`[${id}]`);
		if (title) header.push(title);
		doc
			.font("Helvetica-Bold")
			.fontSize(11)
			.fillColor(COLORS.heading)
			.text(header.join(" "), x);
		doc.fillColor("#000");

		if (data.description && typeof data.description === "string") {
			doc
				.font("Helvetica")
				.fontSize(9)
				.fillColor(COLORS.muted)
				.text(data.description, x, undefined, {
					width: 500 - depth * INDENT,
				});
			doc.fillColor("#000");
		}
		doc.moveDown(0.2);
	}

	const skipKeys = new Set(
		title || id ? ["id", "title", "name", "description"] : [],
	);

	for (const [key, val] of Object.entries(data)) {
		if (skipKeys.has(key)) continue;
		renderValue(doc, key, val, depth);
	}
}

export async function generateArtifactPdf(
	data: unknown,
	filename: string,
): Promise<Buffer> {
	const doc = new PDFDocument({
		margins: { top: 40, bottom: 40, left: MARGIN_LEFT, right: 40 },
		size: "A4",
		info: { Title: filename },
	});

	const chunks: Buffer[] = [];
	doc.on("data", (chunk: Buffer) => chunks.push(chunk));

	// Title
	doc
		.font("Helvetica-Bold")
		.fontSize(16)
		.fillColor(COLORS.heading)
		.text(filename);
	doc.fillColor("#000").moveDown(0.5);

	if (typeof data === "string") {
		doc.font("Courier").fontSize(9).text(data, {
			width: 500,
		});
	} else if (typeof data === "object" && data !== null) {
		const obj = data as Record<string, unknown>;
		if (Object.keys(obj).length === 0) {
			doc
				.font("Helvetica-Oblique")
				.fontSize(10)
				.fillColor(COLORS.muted)
				.text("No content");
		} else {
			renderObject(doc, obj, 0);
		}
	} else {
		doc
			.font("Helvetica")
			.fontSize(10)
			.text(String(data ?? ""));
	}

	doc.end();

	return new Promise<Buffer>((resolve, reject) => {
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);
	});
}
