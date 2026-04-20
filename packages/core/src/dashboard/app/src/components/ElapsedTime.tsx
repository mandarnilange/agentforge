import { useEffect, useState } from "react";

/** Shows a live-updating elapsed time since `startedAt`. */
export function ElapsedTime({ startedAt }: { startedAt: string }) {
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, []);

	const elapsed = Math.max(0, now - new Date(startedAt).getTime());
	const seconds = Math.floor(elapsed / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	let display: string;
	if (hours > 0) {
		display = `${hours}h ${minutes % 60}m`;
	} else if (minutes > 0) {
		display = `${minutes}m ${seconds % 60}s`;
	} else {
		display = `${seconds}s`;
	}

	return <span>{display}</span>;
}
