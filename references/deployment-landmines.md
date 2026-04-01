# Deployment Landmines

Stack-specific warnings for Next.js + Prisma + SQLite + Anthropic API.

## Next.js App Router
- **Server vs Client boundary**: `fs`, `child_process`, and Prisma can ONLY be used in server components and API routes. Any component using these must NOT have "use client" directive.
- **Route handlers**: API route files must export named HTTP method functions (GET, POST, etc.), not default exports.
- **Dynamic routes**: `[slug]` directories must use `params` prop correctly — it's a Promise in Next.js 15+.
- **Metadata**: Use `generateMetadata` in server components, not in client components.
- **Streaming**: When using Anthropic API streaming in API routes, use `ReadableStream` and proper `Response` objects.

## Prisma + SQLite
- **WAL mode**: Enable WAL journal mode for concurrent reads: `PRAGMA journal_mode=WAL` on connection.
- **No migrations in production**: For SQLite, use `prisma db push` instead of `prisma migrate` in production/development.
- **File path**: SQLite database file path is relative to the Prisma schema location, not the project root.
- **JSON fields**: SQLite doesn't support native JSON. Store as String and parse/stringify manually. Do NOT use `Json` type in schema.
- **Connection pooling**: SQLite doesn't need connection pooling. Single connection is fine for a local app.
- **Concurrent writes**: SQLite has a single-writer limitation. Use transactions for write operations that must be atomic.

## Shell Execution (gh, op CLIs)
- **child_process**: Use `execAsync` (promisified exec) for CLI calls. Always handle stderr.
- **Input sanitization**: NEVER pass user input directly to shell commands. Use argument arrays or escape properly.
- **Async handling**: CLI calls can be slow. Use proper timeout handling and don't block the event loop.
- **Auth assumption**: Both `gh` and `op` CLIs are assumed pre-authenticated on the developer's machine.

## Anthropic API
- **Server-side only**: NEVER expose ANTHROPIC_API_KEY to client code. All API calls go through API routes.
- **Streaming**: Use the streaming API for the wizard chat to avoid timeout issues on long responses.
- **Rate limits**: Handle 429 errors gracefully with exponential backoff.
- **Model selection**: Default to claude-sonnet-4-6 for the wizard chat (good balance of speed and quality).
- **Context management**: The wizard chat should include relevant knowledge base entries in the system prompt, not in every user message.

## All Stacks
- **File paths**: Use `path.resolve()` and `path.join()` — never string concatenation for paths.
- **Error boundaries**: Use Next.js `error.tsx` files for graceful error handling per route segment.
- **Loading states**: Use `loading.tsx` for route-level loading skeletons.
- **.env.local**: Never commit. Always have .env.example with placeholder values.
