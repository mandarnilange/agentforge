import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./layouts/AppShell";
import { Costs } from "./pages/Costs";
import { Gates } from "./pages/Gates";
import { Nodes } from "./pages/Nodes";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { PipelineDetail } from "./pages/PipelineDetail";
import { Settings } from "./pages/Settings";

export function App() {
	return (
		<Routes>
			<Route element={<AppShell />}>
				<Route index element={<Overview />} />
				<Route path="dashboard" element={<Navigate to="/" replace />} />
				<Route path="pipelines/:id" element={<PipelineDetail />} />
				<Route path="gates" element={<Gates />} />
				<Route path="nodes" element={<Nodes />} />
				<Route path="costs" element={<Costs />} />
				<Route path="settings" element={<Settings />} />
				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}
