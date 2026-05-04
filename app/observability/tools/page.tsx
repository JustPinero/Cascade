/**
 * Phase 24.2 — tool-call observability table.
 *
 * Server component, no charts. Filters via searchParams. Cursor
 * pagination. Same shape as /observability/cache.
 */
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getToolCallEvents } from "@/lib/observability/tool-call-events";

export const dynamic = "force-dynamic";

interface PageSearchParams {
  toolName?: string;
  sessionId?: string;
  success?: string;
  since?: string;
  until?: string;
  cursor?: string;
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseSuccess(s: string | undefined): boolean | undefined {
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default async function ToolsObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const sp = await searchParams;
  const since = parseDate(sp.since);
  const until = parseDate(sp.until);
  const success = parseSuccess(sp.success);
  const cursorId = sp.cursor ? Number(sp.cursor) : undefined;

  const result = await getToolCallEvents(prisma, {
    toolName: sp.toolName || undefined,
    sessionId: sp.sessionId || undefined,
    success,
    since,
    until,
    cursorId: Number.isFinite(cursorId) ? cursorId : undefined,
    pageSize: 100,
  });

  return (
    <main className="container mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Tool-Call Observability</h1>
        <p className="text-sm text-space-400 mt-1">
          One row per Overseer tool execution. Useful for spotting
          tools the model never picks, tools that fail often, or
          sessions that hit the iteration limit.
        </p>
      </header>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-space-800 rounded"
      >
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Tool name</span>
          <input
            type="text"
            name="toolName"
            defaultValue={sp.toolName ?? ""}
            placeholder="query_project"
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Session ID</span>
          <input
            type="text"
            name="sessionId"
            defaultValue={sp.sessionId ?? ""}
            placeholder="cuid…"
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-space-400 mb-1">Success</span>
          <select
            name="success"
            defaultValue={sp.success ?? ""}
            className="bg-space-900 border border-space-700 rounded px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="true">Success</option>
            <option value="false">Failure</option>
          </select>
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
          href="/observability/tools"
          className="text-space-400 hover:text-text text-sm py-1.5"
        >
          Clear
        </Link>
      </form>

      {result.rows.length === 0 ? (
        <div className="text-center py-12 text-space-400">
          No tool-call events yet.
          <p className="text-xs mt-2">
            Rows appear after the Overseer executes any registered tool.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-space-400 border-b border-space-700">
              <tr>
                <th className="text-left py-2 pr-3">Time</th>
                <th className="text-left py-2 pr-3">Session</th>
                <th className="text-right py-2 pr-3">Iter</th>
                <th className="text-left py-2 pr-3">Tool</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-right py-2 pr-3">Output bytes</th>
                <th className="text-right py-2 pr-3">Latency</th>
                <th className="text-left py-2 pr-3">Input (truncated)</th>
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
                  <td className="py-2 pr-3 text-space-400 text-xs font-mono">
                    {r.sessionId.slice(0, 8)}
                  </td>
                  <td className="py-2 pr-3 text-right text-space-400">
                    {r.iteration}
                  </td>
                  <td className="py-2 pr-3 font-mono">{r.toolName}</td>
                  <td className="py-2 pr-3">
                    {r.success ? (
                      <span className="text-success">ok</span>
                    ) : (
                      <span className="text-amber" title={r.errorMessage ?? ""}>
                        fail
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{r.outputSize}</td>
                  <td className="py-2 pr-3 text-right text-space-400">
                    {r.durationMs}ms
                  </td>
                  <td className="py-2 pr-3 text-space-400 text-xs font-mono">
                    {truncate(r.input, 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.nextCursor !== null && (
            <div className="mt-4 text-center">
              <Link
                href={{
                  pathname: "/observability/tools",
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
