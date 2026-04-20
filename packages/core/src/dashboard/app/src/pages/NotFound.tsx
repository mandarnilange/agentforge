import { Link } from "react-router";

export function NotFound() {
	return (
		<div className="flex flex-col items-center justify-center py-24">
			<h1 className="text-4xl font-bold text-muted">404</h1>
			<p className="mt-2 text-sm text-muted">Page not found</p>
			<Link to="/" className="mt-4 text-sm text-link hover:underline">
				Back to Overview
			</Link>
		</div>
	);
}
