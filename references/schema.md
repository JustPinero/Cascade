# Data Model Reference

## Project
The central entity. Represents a software project being monitored.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| name | String | — | Display name |
| slug | String | — | Unique, URL-safe identifier |
| path | String | — | Absolute filesystem path |
| status | String | "building" | building, complete, deployed, paused, archived |
| stack | String (JSON) | "{}" | Frontend, backend, db, hosting, language |
| currentPhase | String | "phase-1-foundation" | Current development phase |
| currentRequest | String? | null | Current request number (e.g., "2.3") |
| health | String | "idle" | healthy, warning, blocked, idle |
| healthDetails | String (JSON) | "{}" | Test pass rate, debt count, blockers |
| githubRepo | String? | null | e.g., "username/my-app" |
| autonomyMode | String | "semi" | full, semi, manual |
| agentTeamsEnabled | Boolean | false | — |
| prWorkflowEnabled | Boolean | false | — |
| progressScore | Int | 0 | 0-100 composite progress score |
| progressDetails | String (JSON) | "{}" | Breakdown: phases, tests, readiness scores |
| deploymentInfo | String (JSON) | "{}" | Deployment URL, provider, health endpoint |
| lastSessionEndedAt | DateTime? | null | When last Claude session ended |
| kickoffTemplateId | Int? | null | FK to KickoffTemplate |
| lastActivityAt | DateTime | now() | — |
| lastScannedAt | DateTime | now() | — |
| createdAt | DateTime | now() | — |
| updatedAt | DateTime | auto | — |

**Relations:** lessons[], auditSnapshots[], activityEvents[], kickoffTemplate?

## HumanTask
Tasks that require human action — assets, credentials, manual testing, etc.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| title | String | — | Task description |
| category | String | "other" | asset, credential, testing, deploy, review, external, other |
| priority | String | "normal" | high, normal, low |
| status | String | "pending" | pending, done |
| projectId | Int? | null | FK to Project |
| projectSlug | String? | null | Project slug for display |
| createdBy | String | "claude" | claude, user, delamain |
| createdAt | DateTime | now() | — |
| completedAt | DateTime? | null | When marked done |

**Relations:** project?

## KnowledgeLesson
Lessons harvested from project audits and corrections.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| title | String | — | Lesson title |
| content | String | — | Markdown content |
| category | String | — | deployment, auth, database, performance, testing, error-handling, integrations, anti-patterns, architecture, tooling |
| sourceProjectId | Int? | null | FK to Project |
| sourceFile | String? | null | File where lesson was found |
| sourcePhase | String? | null | Phase when discovered |
| tags | String (JSON) | "[]" | Array of tag strings |
| severity | String | "nice-to-know" | critical, important, nice-to-know |
| discoveredAt | DateTime | now() | — |
| verified | Boolean | false | Manually verified |
| timesReferenced | Int | 0 | Incremented on read |

**Relations:** sourceProject?

## KickoffTemplate
Templates used to generate project kickoff prompts.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| name | String | — | Template name |
| description | String | — | Brief description |
| content | String | — | Full markdown template |
| projectType | String | "web-app" | web-app, game, api, mobile, other |
| isDefault | Boolean | false | Default template flag |
| createdAt | DateTime | now() | — |
| updatedAt | DateTime | auto | — |

**Relations:** projects[]

## AuditSnapshot
Point-in-time audit results for a project.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int | — | FK to Project |
| phase | String | — | Phase when captured |
| auditType | String | — | test-audit, bughunt, optimize, drift-audit |
| grade | String? | null | A, B, Critical, etc. |
| findings | String (JSON) | "{}" | Structured results |
| isRead | Boolean | false | Powers unread indicators |
| capturedAt | DateTime | now() | — |

**Relations:** project

## ActivityEvent
Timeline of project events.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int? | null | FK to Project (null for cross-project) |
| eventType | String | — | commit, phase-complete, audit-complete, lesson-harvested, advisory-sent, project-created, blocker-detected, debt-resolved, session-complete |
| summary | String | — | Event description |
| details | String? | null | JSON details |
| createdAt | DateTime | now() | — |

**Relations:** project?
