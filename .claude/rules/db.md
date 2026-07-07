---
paths:
  - "prisma/**"
---
# Prisma + SQLite Rules

- The live database is `./dev.db` at the project root — NOT `prisma/dev.db`. SQLite paths in the datasource are relative to the schema file location.
- Sync schema with `pnpm exec prisma db push` — do NOT use `prisma migrate` (dev or prod) for this SQLite setup.
- No native JSON in SQLite: store JSON as `String` and parse/stringify manually. Never use the `Json` type in schema.prisma.
- SQLite is single-writer: wrap multi-statement writes that must be atomic in `prisma.$transaction`.
- No connection pooling needed — single connection is fine for this local app.
- Enable WAL mode for concurrent reads (`PRAGMA journal_mode=WAL`).
- After any schema change, update `references/schema.md` to match.
