/**
 * Phase 42 — SQLite boot pragmas (P0.5, audits/fable-review-2026-07-16.md).
 *
 * The better-sqlite3 adapter leaves journal_mode at SQLite's default
 * (`delete`), so every commit pays a rollback-journal create/fsync/delete
 * cycle and cross-process access (prisma studio, db push, CLI) blocks
 * against the writer. `.claude/rules/db.md` has mandated WAL all along —
 * this actually applies it.
 *
 * WAL is persistent in the DB file, so one successful boot sets it for
 * good; running this every boot is a cheap no-op thereafter.
 * `synchronous=NORMAL` is the recommended pairing with WAL (fsync on
 * checkpoint, not per-commit) and is connection-scoped, so it must run
 * each boot.
 *
 * Never throws: a pragma failure is logged and boot continues — a dev
 * dashboard must never fail to start over a journal-mode preference.
 */
type PragmaClient = {
  $queryRawUnsafe(query: string): Promise<unknown>;
};

export async function applySqlitePragmas(client: PragmaClient): Promise<void> {
  try {
    await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await client.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
  } catch (err) {
    console.error(
      `[db-pragmas] failed to apply SQLite pragmas: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
