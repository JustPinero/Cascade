#!/usr/bin/env npx tsx
/**
 * Migration repair CLI — handles stale paths and orphaned project rows after
 * a machine migration (e.g. Mac → Windows).
 *
 * Usage:
 *   npx tsx scripts/migrate-paths.ts --scan-only
 *   npx tsx scripts/migrate-paths.ts --dry-run --apply-all
 *   npx tsx scripts/migrate-paths.ts --apply <id> <action>
 *   npx tsx scripts/migrate-paths.ts --apply-all
 *   npx tsx scripts/migrate-paths.ts --apply-all --json
 */

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { scanForOrphans, recommend, applyRepair, type Orphan, type RepairAction } from "../lib/migration-repair";
import { resolveProjectsDir } from "../lib/validators";
import path from "path";

const args = process.argv.slice(2);

const SCAN_ONLY = args.includes("--scan-only");
const DRY_RUN = args.includes("--dry-run");
const APPLY_ALL = args.includes("--apply-all");
const JSON_OUTPUT = args.includes("--json");

const applyIdx = args.indexOf("--apply");
const APPLY_ID = applyIdx !== -1 ? Number(args[applyIdx + 1]) : null;
const APPLY_ACTION = applyIdx !== -1 ? (args[applyIdx + 2] as RepairAction) : null;

const DB_URL = process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), "dev.db")}`;

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: DB_URL });
  const prisma = new PrismaClient({ adapter });
  const projectsDir = resolveProjectsDir();

  try {
    const orphans = await scanForOrphans(prisma, { projectsDir });

    if (SCAN_ONLY) {
      printOrphans(orphans);
      process.exit(0);
    }

    if (APPLY_ID !== null && APPLY_ACTION) {
      const valid: RepairAction[] = ["clone", "archive", "delete", "skip"];
      if (!valid.includes(APPLY_ACTION)) {
        console.error(`Unknown action "${APPLY_ACTION}". Choose from: ${valid.join(", ")}`);
        process.exit(1);
      }

      const result = await applyRepair(prisma, APPLY_ID, APPLY_ACTION, {
        projectsDir,
        dryRun: DRY_RUN,
      });

      if (JSON_OUTPUT) {
        console.log(JSON.stringify(result));
      } else {
        console.log(result.message);
      }
      process.exit(0);
    }

    if (APPLY_ALL) {
      if (orphans.length === 0) {
        if (!JSON_OUTPUT) console.log("No orphaned projects found. Nothing to do.");
        else console.log(JSON.stringify([]));
        process.exit(0);
      }

      const results = [];
      for (const orphan of orphans) {
        const action = recommend(orphan);
        if (action === "skip") {
          results.push({ action, projectId: orphan.id, message: `Skipped "${orphan.name}"` });
          continue;
        }
        const result = await applyRepair(prisma, orphan.id, action, {
          projectsDir,
          dryRun: DRY_RUN,
        });
        results.push(result);
      }

      if (JSON_OUTPUT) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) console.log(r.message);
      }
      process.exit(0);
    }

    // Default: scan-only output
    printOrphans(orphans);
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

function printOrphans(orphans: Orphan[]) {
  if (orphans.length === 0) {
    console.log("No orphaned projects found.");
    return;
  }
  console.log(`Found ${orphans.length} orphaned project(s):\n`);
  for (const o of orphans) {
    const rec = recommend(o);
    console.log(`  [${o.id}] ${o.slug} (status: ${o.status})`);
    console.log(`       old path:  ${o.oldPath}`);
    console.log(`       suggested: ${o.candidates.suggestedLocalPath}`);
    console.log(`       on disk:   ${o.candidates.onDiskNow}`);
    console.log(`       remote:    ${o.candidates.githubRemote ?? "(none)"}`);
    console.log(`       recommend: ${rec}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
