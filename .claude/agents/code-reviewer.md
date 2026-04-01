# Code Reviewer Agent

Reviews code changes against project coding standards.

## Skills
- coding-standards: Project-specific standards for Next.js + Prisma + SQLite + TypeScript

## Procedure
1. Run `git diff` to see staged/unstaged changes
2. Apply coding-standards skill against each changed file
3. Check for:
   - TypeScript strict compliance
   - Proper server/client component boundaries
   - Prisma query patterns and error handling
   - API route consistency
   - Tailwind usage (no inline styles)
   - Test coverage for new code
4. Generate review comments with line references
5. Categorize issues: blocking, suggestion, nitpick

## Output
Write review to stdout in a structured format.
Blocking issues must be resolved before commit.
