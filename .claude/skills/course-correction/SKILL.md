# Course Correction

## When to Use
Run when work has gone off track — scope creep, missed acceptance criteria, or unexpected technical debt introduced. Compares actual work against the current request's specification.

## Procedure

### 1. Identify Current Request
Read the current request file from `requests/` directory based on the project's currentRequest field.

### 2. Diff Against Acceptance Criteria
- List each acceptance criterion from the request
- For each, determine: met / partially met / not met / not attempted
- Identify work done that is NOT in the acceptance criteria (scope creep)

### 3. Assess Introduced Debt
- Check for TODO/FIXME/HACK comments added
- Check for skipped tests or weakened assertions
- Check for hardcoded values that should be configurable
- Check audits/debt.md for items added during this work

### 4. Generate Correction Plan
For each issue found:
- **Revert**: Work that's out of scope and should be removed
- **Add**: Acceptance criteria not yet met
- **Fix**: Work that partially meets criteria but needs adjustment

### 5. Write Report
Save to `audits/correction-{YYYY-MM-DD}.md`

## Output Format
```
## Course Correction Report — Request X.Y

### Acceptance Criteria Status
- [MET] Criterion 1
- [PARTIAL] Criterion 2 — what's missing
- [NOT MET] Criterion 3

### Scope Creep
- Added feature X — not in request, recommend reverting
- Refactored Y — not in request, but improves quality (keep?)

### Introduced Debt
- TODO in path/to/file:line — Description
- Skipped test for edge case X

### Correction Actions
1. [REVERT] Description
2. [ADD] Description
3. [FIX] Description
```
