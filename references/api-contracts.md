# API Contracts

## Projects

### GET /api/projects
Returns all projects with health indicators.

### POST /api/projects
Create a new project.

### POST /api/projects/scan
Trigger a filesystem scan of all projects.

### GET /api/projects/[slug]
Get a single project by slug.

### PATCH /api/projects/[slug]
Update a project.

---

## Knowledge

### GET /api/knowledge
Get all knowledge lessons.

### POST /api/knowledge
Create a new knowledge lesson.

### POST /api/knowledge/harvest
Trigger knowledge harvesting across all projects.

### GET /api/knowledge/search
Search knowledge lessons.

---

## Reports

### POST /api/reports/generate
Generate a PDF report (single-project or cross-project).

---

## Wizard

### POST /api/wizard/chat
Stream a Claude conversation for the project creation wizard.

---

## Templates

### GET /api/templates
Get all kickoff templates.

### POST /api/templates
Create a new template.

### PATCH /api/templates/[id]
Update a template.

### DELETE /api/templates/[id]
Delete a template.

---

## Integrations

### POST /api/integrations/github
Create a GitHub repository.

### GET /api/integrations/onepassword
Get 1Password env var status for a project.

### POST /api/integrations/onepassword
Populate .env.local from 1Password.

### GET /api/integrations/deploy-status
Get deployment status from Vercel/Railway.
