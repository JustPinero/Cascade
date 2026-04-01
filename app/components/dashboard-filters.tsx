"use client";

import { useEffect, useRef } from "react";

export interface FilterState {
  search: string;
  status: string | null;
  groupBy: "none" | "status";
}

interface DashboardFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

const statusOptions = [
  { value: null, label: "All" },
  { value: "building", label: "Building" },
  { value: "deployed", label: "Deployed" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

export function DashboardFilters({
  filters,
  onChange,
}: DashboardFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "/" && document.activeElement === document.body) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, []);

  const hasActiveFilters =
    filters.search !== "" || filters.status !== null;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <input
          ref={searchRef}
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search projects..."
          className="w-full px-3 py-2 text-sm font-mono bg-space-800 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none transition-colors"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-space-500 border border-space-600 px-1.5 py-0.5">
          /
        </kbd>
      </div>

      {/* Status filter */}
      <div className="flex gap-1">
        {statusOptions.map((opt) => (
          <button
            key={opt.label}
            onClick={() =>
              onChange({ ...filters, status: opt.value })
            }
            className={`
              px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider
              border transition-colors
              ${
                filters.status === opt.value
                  ? "border-cyan text-cyan bg-cyan/8"
                  : "border-space-600 text-space-500 hover:text-text hover:border-space-500"
              }
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Group toggle */}
      <button
        onClick={() =>
          onChange({
            ...filters,
            groupBy: filters.groupBy === "none" ? "status" : "none",
          })
        }
        className={`
          px-2.5 py-1.5 text-xs font-mono uppercase tracking-wider
          border transition-colors
          ${
            filters.groupBy === "status"
              ? "border-accent text-accent bg-accent/8"
              : "border-space-600 text-space-500 hover:text-text hover:border-space-500"
          }
        `}
      >
        Group
      </button>

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={() =>
            onChange({ search: "", status: null, groupBy: filters.groupBy })
          }
          className="px-2.5 py-1.5 text-xs font-mono text-danger border border-danger/30 hover:bg-danger/10 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
