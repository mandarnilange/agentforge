import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type ResourceDef } from "../api/client";

type SettingsTab = "agents" | "pipelines" | "nodes" | "schemas";

const TAB_CONFIG: Record<
	SettingsTab,
	{
		label: string;
		itemLabel: string;
		listKey: string;
		detailKey: string;
		list: () => Promise<ResourceDef[]>;
		detail: (name: string) => Promise<ResourceDef>;
	}
> = {
	agents: {
		label: "Agent",
		itemLabel: "agent",
		listKey: "agent-defs",
		detailKey: "agent-def",
		list: () => api.listAgentDefs(),
		detail: (name) => api.getAgentDef(name),
	},
	pipelines: {
		label: "Pipeline",
		itemLabel: "pipeline",
		listKey: "pipeline-defs",
		detailKey: "pipeline-def",
		list: () => api.listPipelineDefs(),
		detail: (name) => api.getPipelineDef(name),
	},
	nodes: {
		label: "Node",
		itemLabel: "node",
		listKey: "node-defs",
		detailKey: "node-def",
		list: () => api.listNodeDefs(),
		detail: (name) => api.getNodeDef(name),
	},
	schemas: {
		label: "Schema",
		itemLabel: "schema",
		listKey: "schema-defs",
		detailKey: "schema-def",
		list: () => api.listSchemaDefs(),
		detail: (name) => api.getSchemaDef(name),
	},
};

export function Settings() {
	const [tab, setTab] = useState<SettingsTab>("agents");

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-white">Settings</h1>

			<div className="flex gap-2 border-b border-gray-700 pb-2">
				{(Object.keys(TAB_CONFIG) as SettingsTab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`px-4 py-2 rounded-t text-sm font-medium ${
							tab === t
								? "bg-gray-700 text-white"
								: "text-gray-400 hover:text-white"
						}`}
					>
						{t.charAt(0).toUpperCase() + t.slice(1)}
					</button>
				))}
			</div>

			<DefinitionSettings key={tab} tab={tab} />
		</div>
	);
}

function DefinitionSettings({ tab }: { tab: SettingsTab }) {
	const config = TAB_CONFIG[tab];
	const [selected, setSelected] = useState<string | null>(null);

	const {
		data: items = [],
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: [config.listKey],
		queryFn: config.list,
	});

	useEffect(() => {
		const first = items[0];
		if (!selected && first) {
			setSelected(first.name);
		}
	}, [items, selected]);

	const detail = useQuery({
		queryKey: [config.detailKey, selected],
		queryFn: () => (selected ? config.detail(selected) : null),
		enabled: !!selected,
	});

	if (isLoading) return <div className="text-gray-400">Loading...</div>;
	if (isError) {
		return (
			<div className="rounded border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
				Failed to load {config.itemLabel} definitions:{" "}
				{error?.message ?? "Unknown error"}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-3 gap-4">
			<div className="col-span-1 space-y-1">
				<h3 className="text-sm font-medium text-gray-400 mb-2">
					{config.label} Definitions ({items.length})
				</h3>
				{items.length === 0 && (
					<div className="text-sm text-gray-500">
						No {config.itemLabel} definitions found.
					</div>
				)}
				{items.map((item) => (
					<button
						key={item.name}
						type="button"
						onClick={() => setSelected(item.name)}
						className={`w-full text-left px-3 py-2 rounded text-sm ${
							selected === item.name
								? "bg-blue-600 text-white"
								: "text-gray-300 hover:bg-gray-700"
						}`}
					>
						{item.name}
						<span className="text-gray-500 ml-2">v{item.version}</span>
					</button>
				))}
			</div>

			<div className="col-span-2">
				{!selected && (
					<div className="text-gray-500 text-sm">
						Select a {config.itemLabel} definition to view
					</div>
				)}
				{selected && detail.isLoading && (
					<div className="text-sm text-gray-400">Loading details...</div>
				)}
				{selected && detail.isError && (
					<div className="rounded border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
						Failed to load details:{" "}
						{detail.error?.message ?? "Unknown error"}
					</div>
				)}
				{selected && detail.isSuccess && detail.data && (
					<DefinitionViewer def={detail.data} />
				)}
			</div>
		</div>
	);
}

function DefinitionViewer({ def }: { def: ResourceDef }) {
	const yaml = def.specYaml ?? "";

	return (
		<div className="space-y-3">
			<div>
				<h3 className="text-lg font-medium text-white">{def.name}</h3>
				<span className="text-gray-500 text-sm">
					{def.kind} · v{def.version}
				</span>
			</div>

			{yaml ? (
				<pre
					tabIndex={0}
					className="w-full h-96 overflow-auto bg-gray-900 text-gray-200 font-mono text-sm p-3 rounded border border-gray-700 focus:border-blue-500 focus:outline-none whitespace-pre"
				>
					<code>{yaml}</code>
				</pre>
			) : (
				<div className="w-full p-3 rounded border border-gray-700 bg-gray-900 text-sm text-gray-500">
					No specification available.
				</div>
			)}
		</div>
	);
}
