import { prisma } from "@/lib/db";
import { scanForOrphans, recommend, type Orphan, type RepairAction } from "@/lib/migration-repair";
import { resolveProjectsDir } from "@/lib/validators";
import { MigrateClient } from "./migrate-client";

export const dynamic = "force-dynamic";

export default async function MigratePage() {
  let orphans: Orphan[] = [];
  let scanError: string | null = null;

  try {
    const projectsDir = resolveProjectsDir();
    orphans = await scanForOrphans(prisma, { projectsDir });
  } catch (err) {
    scanError = err instanceof Error ? err.message : "Scan failed";
  }

  const rows = orphans.map((o) => ({
    ...o,
    recommendedAction: recommend(o) as RepairAction,
  }));

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-mono font-bold text-space-100 mb-2">
        Migration Repair
      </h1>
      <p className="text-sm text-space-400 mb-6">
        Projects in the database whose on-disk path no longer exists. Choose how
        to handle each one.
      </p>

      {scanError && (
        <div className="border border-error/60 bg-error/5 px-4 py-3 text-sm text-error mb-4">
          Scan error: {scanError}
        </div>
      )}

      {rows.length === 0 && !scanError && (
        <div className="border border-success/40 bg-success/5 px-4 py-3 text-sm text-success font-mono">
          All projects healthy — no orphaned paths found.
        </div>
      )}

      {rows.length > 0 && <MigrateClient rows={rows} />}
    </div>
  );
}
