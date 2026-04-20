import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

const STORAGE_KEY = "sdlc-refresh-interval";
const DEFAULT_INTERVAL = 3000;

export type RefreshOption = 3000 | 5000 | 10000 | 30000 | 0;

export const REFRESH_OPTIONS: { value: RefreshOption; label: string }[] = [
	{ value: 3000, label: "3s" },
	{ value: 5000, label: "5s" },
	{ value: 10000, label: "10s" },
	{ value: 30000, label: "30s" },
	{ value: 0, label: "Off" },
];

function loadInterval(): RefreshOption {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const val = Number(stored);
			if (REFRESH_OPTIONS.some((o) => o.value === val))
				return val as RefreshOption;
		}
	} catch {
		// localStorage unavailable
	}
	return DEFAULT_INTERVAL;
}

export function useRefreshInterval() {
	const queryClient = useQueryClient();
	const [interval, setIntervalState] = useState<RefreshOption>(loadInterval);

	const setInterval = useCallback(
		(value: RefreshOption) => {
			setIntervalState(value);
			localStorage.setItem(STORAGE_KEY, String(value));
			queryClient.setDefaultOptions({
				queries: {
					refetchInterval: value || false,
					staleTime: 1000,
					retry: 1,
				},
			});
			queryClient.invalidateQueries();
		},
		[queryClient],
	);

	return { interval, setInterval };
}
