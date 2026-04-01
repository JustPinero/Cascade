# Performance Optimization Audit

## When to Use
Run before deployment, when the app feels slow, or as a periodic health check. Identifies performance bottlenecks in the Next.js + Prisma + SQLite stack.

## Procedure

### 1. Bundle Analysis
```
pnpm build
```
- Flag any page bundle over 100KB first-load JS
- Identify largest chunks and their contents
- Look for large dependencies that could be tree-shaken or replaced

### 2. Client Component Audit
Scan all files with `"use client"` directive:
- Does it actually need client-side features?
- Could data-fetching be split into a server parent with a smaller client child?
- Are large libraries imported in client components unnecessarily?

### 3. Server Component Usage
- Data fetching should happen in Server Components, not via useEffect
- Heavy dependencies (date libs, markdown parsers) should stay server-side
- Verify async/await is used directly in Server Components

### 4. Prisma Query Efficiency
- **N+1 queries**: Loop queries replaceable with `include` or `where: { id: { in: [...] } }`
- **Over-fetching**: Queries without `select` returning unused fields
- **Missing indexes**: Frequent WHERE/ORDER BY patterns without schema indexes
- **Unbounded results**: Queries without `take`/`skip` pagination

### 5. Caching Strategy
- API routes returning stable data should use Cache-Control headers
- Static pages should use `generateStaticParams`
- SQLite configured with WAL mode for read concurrency
- Consider `unstable_cache` for expensive computations

### 6. Memory Leak Detection
- setInterval/setTimeout without cleanup in useEffect
- Event listeners without removal
- Growing arrays/maps without bounds
- Prisma client instances created repeatedly (should be singleton)

## Output Format
```
## Performance Audit Report

### Bundle: Total first-load JS: X KB
- Largest pages and sizes

### Quick Wins (Low effort, High impact)
- [OPT-001] Description — Effort: Low | Impact: High

### Medium Effort
- [OPT-002] Description — Effort: Medium | Impact: High

### Memory/Stability
- [MEM-001] path/to/file:line — Issue description

### Summary
- Quick wins: N | Medium effort: N | Large refactors: N
```
