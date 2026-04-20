import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";

const stored = localStorage.getItem("sdlc-refresh-interval");
const initialInterval = stored ? Number(stored) : 3000;

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchInterval: initialInterval || false,
			staleTime: 1000,
			retry: 1,
		},
	},
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>,
);
