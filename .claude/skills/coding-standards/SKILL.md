# Coding Standards — Next.js + Prisma + SQLite + TypeScript

## When to Use
Apply during code review, after writing new code, or when onboarding to verify code meets project standards.

## Standards

### TypeScript
- Strict mode enabled — no `any`, no `@ts-ignore`, no `as unknown as`
- All function parameters and return types should be inferrable or explicit
- Use discriminated unions over type assertions
- Prefer `interface` for object shapes, `type` for unions/intersections
- No non-null assertions (`!`) — handle null/undefined properly

### Next.js App Router
- **Server Components by default** — only add `"use client"` when using useState, useEffect, event handlers, or browser APIs
- Prisma, `fs`, `child_process` only in server components and API routes
- API routes export named functions (GET, POST, etc.), not default exports
- Use `loading.tsx` for route-level loading states
- Use `error.tsx` for route-level error boundaries
- Dynamic params (`[slug]`) accessed via Promise params in Next.js 15+

### Prisma + SQLite
- Use singleton Prisma client (lib/db.ts)
- JSON stored as String — parse/stringify manually, never use Prisma `Json` type with SQLite
- Enable WAL mode for concurrent reads
- All database queries in server components or API routes only
- Use `select` to fetch only needed fields
- Use transactions for multi-step writes
- Handle Prisma errors with specific catch (PrismaClientKnownRequestError)

### File Organization
- File naming: kebab-case for files (`project-tile.tsx`), PascalCase for component names (`ProjectTile`)
- One component per file for major components
- Shared utilities in `lib/`
- API route handlers in `app/api/`

### Styling
- Tailwind CSS for all styling — no inline styles, no CSS modules, no styled-components
- Use Tailwind color palette defined in the project (cyberpunk theme)
- Responsive design: mobile-first with Tailwind breakpoints

### Async/Promises
- All async operations properly awaited — no floating promises
- Use try/catch for async error handling
- API routes always return proper Response objects with status codes
- No callback-style async (use async/await)

### Security
- Never expose ANTHROPIC_API_KEY or other secrets to client code
- Sanitize inputs before shell command execution (child_process)
- Validate all API route inputs
- No user input in SQL queries (Prisma handles this, but be aware with raw queries)

### Testing
- Test files colocated or in parallel structure: `file.test.ts` alongside `file.ts`
- Descriptive test names: "should return 404 when project not found"
- Test behavior, not implementation details
- Mock external services (Anthropic API, gh CLI, op CLI), not internal modules
