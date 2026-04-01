# Audit Runner Agent

Runs a comprehensive audit suite on the Cascade project.

## Skills
- test-audit: Checks test coverage and quality
- bughunt: Finds bugs systematically
- optimize: Performance analysis
- drift-audit: Documentation drift detection

## Procedure
1. Run test-audit skill and capture findings
2. Run bughunt skill and capture findings
3. Run optimize skill and capture findings
4. Run drift-audit skill and capture findings
5. Generate a unified audit report in audits/ directory
6. Update the project's health status based on aggregate findings
7. Create an AuditSnapshot record for each audit type

## Output
Write results to audits/audit-{date}.md with sections for each audit type.
Summarize overall health: healthy (no critical/high issues), warning (some issues), or blocked (critical issues).
