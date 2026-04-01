# Drift Audit

## When to Use
Run after major feature work, before releases, or when documentation seems stale. Detects divergence between code and documentation.

## Procedure

### 1. Schema Drift: references/schema.md vs prisma/schema.prisma
- Compare all models, fields, types, relations, defaults
- Flag models/fields in docs but not in schema (stale)
- Flag models/fields in schema but not in docs (undocumented)

### 2. API Contract Drift: references/api-contracts.md vs API Routes
- Enumerate all route files under app/api/
- Compare documented endpoints against actual routes
- Check request/response shapes, HTTP methods, status codes
- Flag documented endpoints that no longer exist
- Flag new endpoints not yet documented

### 3. Architecture Drift: references/architecture.md vs Implementation
- Verify directory structure matches docs
- Check described patterns against actual code
- Verify listed technologies and versions

### 4. CLAUDE.md Accuracy
- Verify all listed commands work
- Check that described conventions are followed
- Verify file paths and structures are current

### 5. Environment Variable Drift: references/env-vars.md vs Code
- Search codebase for all `process.env.*` references
- Compare against documented variables
- Flag undocumented vars and stale documented vars

## Output Format
```
## Drift Audit Report

### Schema Drift
| Item | Status | Details |
|------|--------|---------|

### API Contract Drift
| Endpoint | Status | Details |
|----------|--------|---------|

### Architecture Drift
- [DRIFT/OK] Item — Details

### CLAUDE.md Issues
- [STALE/DRIFT/OK] Item — Details

### Env Var Drift
| Variable | Status | Details |
|----------|--------|---------|

### Summary
- In sync: N | Drifted: N | Stale: N | Missing docs: N
```
