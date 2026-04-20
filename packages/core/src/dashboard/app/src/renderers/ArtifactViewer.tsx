import { useState } from "react";
import { useArtifactContent } from "../api/hooks";
import { getRenderer } from "./registry";

interface Props {
	path: string;
}

function DownloadPdfButton({ path }: { path: string }) {
	const [loading, setLoading] = useState(false);

	const handleDownload = async () => {
		setLoading(true);
		try {
			const res = await fetch(
				`/api/v1/artifact-pdf?path=${encodeURIComponent(path)}`,
			);
			if (!res.ok) throw new Error("PDF generation failed");
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = (path.split("/").pop() ?? "artifact").replace(
				/\.json$/,
				".pdf",
			);
			a.click();
			URL.revokeObjectURL(url);
		} finally {
			setLoading(false);
		}
	};

	return (
		<button
			type="button"
			onClick={handleDownload}
			disabled={loading}
			className="rounded border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-white/[0.05] hover:text-link disabled:opacity-50"
		>
			{loading ? "Generating..." : "PDF"}
		</button>
	);
}

export function ArtifactViewer({ path }: Props) {
	const [expanded, setExpanded] = useState(false);
	const { data, isLoading, error } = useArtifactContent(path, expanded);

	const filename = path.split("/").pop() ?? path;
	const Renderer = getRenderer(filename);

	return (
		<div className="border-b border-border last:border-b-0">
			<div className="flex items-center">
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left hover:bg-white/[0.02]"
				>
					<span
						className="text-[10px] transition-transform"
						style={{ transform: expanded ? "rotate(90deg)" : "" }}
					>
						&#9654;
					</span>
					<span className="font-mono text-xs text-link">{filename}</span>
				</button>
				<div className="pr-3">
					<DownloadPdfButton path={path} />
				</div>
			</div>

			{expanded && (
				<div className="px-4 pb-3">
					{isLoading && (
						<div className="py-2 text-xs text-muted">Loading...</div>
					)}
					{error && (
						<div className="py-2 text-xs text-bad">
							Failed to load: {error.message}
						</div>
					)}
					{data && typeof data.content === "object" && data.content !== null ? (
						<Renderer
							data={data.content as Record<string, unknown>}
							filename={filename}
						/>
					) : data ? (
						<pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
							{String(data.content)}
						</pre>
					) : null}
				</div>
			)}
		</div>
	);
}
