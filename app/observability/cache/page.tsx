/**
 * Phase 23.3 — Anthropic cache observability table.
 *
 * Server component, no charts. Filters via searchParams. Cursor
 * pagination via Next link. Demand-driven enhancement: promote to
 * charts only when patterns recur and the table view stops being
 * enough.
 */
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getUsageEvents } from "@/lib/observability/usage-events";

export const dynamic = "force-dynamic";

interface PageSearchParams {
  callSite?: string;
  model?: string;
  since?: string;
  until?: string;
  cursor?: string;
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatPercent(n: number): string {
  if (n === 0) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default async function CacheObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const sp = await searchParams;
  const since = parseDate(sp.since);
  const until = parseDate(sp.until);
  const cursorId = sp.cursor ? Number(sp.cursor) : undefined;

  const result = await getUsageEvents(prisma, {
    callSite: sp.callSite || undefined,
    model: sp.model || undefined,
    since,
    until,
    cursorId: Number.isFinite(cursorId) ? cursorId : undefined,
    pageSize: 100,
  });

  const callSites = [
    "overseer.chat",
    "summarizer",
    "feature-proposer",
    "wizard",
    "project.chat",
  ];

  return (
    <main className="container mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Anthropic Cache Observability</h1>
        <p className="text-sm text-space-400 mt-1">
          Per-request token usage and cache hit rate. One row per
          Anthropic API call from a buffered call site. Streaming call
          sites (wizard, project chat) wire in a follow-up — see
          audits/debt.md.
        </p>
      </header>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-space-800 rounded"
      >
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Call site</span>
          <select
            name="callSite"
            defaultValue={sp.callSite ?? ""}
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            {callSites.map((cs) => (
              <option key={cs} value={cs}>
                {cs}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Model</span>
          <input
            type="text"
            name="model"
            defaultValue={sp.model ?? ""}
            placeholder="claude-..."
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Since</span>
          <input
            type="date"
            name="since"
            defaultValue={sp.since ?? ""}
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Until</span>
          <input
            type="date"
            name="until"
            defaultValue={sp.until ?? ""}
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="bg-accent text-space-900 rounded px-4 py-1.5 text-sm font-medium"
        >
          Apply
        </button>
        <Link
          href="/observability/cache"
          className="text-space-400 hover:text-text text-sm py-1.5"
        >
          Clear
        </Link>
      </form>

      {result.rows.length === 0 ? (
        <div className="text-center py-12 text-space-400">
          No usage events yet.
          <p className="text-xs mt-2">
            Rows will appear here after the first Anthropic API call from a
            wired call site.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-space-400 border-b border-space-700">
              <tr>
                <th className="text-left py-2 pr-3">Time</th>
                <th className="text-left py-2 pr-3">Call site</th>
                <th className="text-left py-2 pr-3">Model</th>
                <th className="text-right py-2 pr-3">Input</th>
                <th className="text-right py-2 pr-3">Cache read</th>
                <th className="text-right py-2 pr-3">Cache write</th>
                <th className="text-right py-2 pr-3">Output</th>
                <th className="text-right py-2 pr-3">Hit rate</th>
                <th className="text-right py-2 pr-3">Latency</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-space-800 hover:bg-space-800/50"
                >
                  <td className="py-2 pr-3 text-space-400 text-xs whitespace-nowrap">
                    {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="py-2 pr-3">{r.callSite}</td>
                  <td className="py-2 pr-3 text-space-400 text-xs">
                    {r.model}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {formatNumber(r.inputTokens)}
                  </td>
                  <td className="py-2 pr-3 text-right text-success">
                    {r.cacheReadInputTokens > 0
                      ? formatNumber(r.cacheReadInputTokens)
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right text-amber">
                    {r.cacheCreationInputTokens > 0
                      ? formatNumber(r.cacheCreationInputTokens)
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {formatNumber(r.outputTokens)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {formatPercent(r.hitRate)}
                  </td>
                  <td className="py-2 pr-3 text-right text-space-400">
                    {r.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.nextCursor !== null && (
            <div className="mt-4 text-center">
              <Link
                href={{
                  pathname: "/observability/cache",
                  query: { ...sp, cursor: String(result.nextCursor) },
                }}
                className="inline-block px-4 py-2 bg-space-800 hover:bg-space-700 rounded text-sm"
              >
                Older →
              </Link>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
