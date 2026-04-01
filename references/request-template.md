# Request File Template

This is the format for all request files in requests/. Tests are the contract.

```markdown
# Request X.Y — Title

## Objective
Brief description of what this request accomplishes.

## Acceptance Criteria → Tests (write these FIRST)
Each criterion has a corresponding test. Write the test BEFORE the implementation.

| # | Criterion | Test File | Test Name |
|---|-----------|-----------|-----------|
| 1 | App loads at localhost:3000 | e2e/app.spec.ts | "app loads at localhost:3000" |
| 2 | Search filters by name | lib/search.test.ts | "filters projects by name substring" |
| 3 | API returns 404 for missing slug | app/api/__tests__/projects.test.ts | "returns null for missing slug" |

## RED Phase (failing tests)
Write these tests first. They define "done."
- [ ] Test 1: description (file:location)
- [ ] Test 2: description (file:location)
- [ ] Test 3: description (file:location)

## GREEN Phase (implementation)
Files to create/modify to make tests pass:
- path/to/file1.ts — what changes
- path/to/file2.ts — what changes

## Dependencies
- Depends on: X.Y (if any)
```

## Key Principle
The tests ARE the spec. If you can write a test for it, you understand the requirement.
If you can't write a test for it, the requirement is unclear — clarify before proceeding.
