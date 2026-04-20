import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		});
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			title="Copy to clipboard"
			className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-white/5 hover:text-text"
		>
			{copied ? "\u2713" : "\u29c9"}
		</button>
	);
}
