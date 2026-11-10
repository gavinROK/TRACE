"use client";

import { useMemo, useState } from "react";
import { InfraTopologyGraph } from "@/components/infra/InfraTopologyGraph";
import type { InfraTopologySnapshot } from "@/lib/infra-types";

interface TopologyViewProps {
  snapshot: InfraTopologySnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TopologyView({ snapshot, selectedId, onSelect }: TopologyViewProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const categories = useMemo(() => [...new Set(snapshot.nodes.map((n) => n.category))].sort(), [snapshot.nodes]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const nodes = snapshot.nodes.filter(
      (n) =>
        (!query || n.name.toLowerCase().includes(query)) &&
        (categoryFilter === "ALL" || n.category === categoryFilter),
    );
    const visibleIds = new Set(nodes.map((n) => n.id));
    const edges = snapshot.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
    return { ...snapshot, nodes, edges };
  }, [snapshot, search, categoryFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search devices…"
          className="w-56 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
        >
          <option value="ALL">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {filtered.nodes.length} / {snapshot.nodes.length} devices
        </span>
      </div>
      <div className="relative flex-1">
        <InfraTopologyGraph snapshot={filtered} selectedId={selectedId} onSelect={onSelect} />
      </div>
    </div>
  );
}
