# Deployment Playbook

Reusable checklists, scripts, and troubleshooting guides for deploying fullstack apps. Built from real deployment pain encountered across multiple projects.

## Stack Coverage

- Next.js (App Router) on Vercel
- PostgreSQL via Supabase
- Prisma ORM on serverless
- NextAuth.js (Google/GitHub OAuth)
- Stripe billing webhooks
- Playwright/headless browser on serverless

## Structure

```
checklists/       # Pre-deploy, post-deploy, and rollback checklists
guides/           # Deep-dive troubleshooting guides by topic
scripts/          # Automation scripts for common deployment tasks
lessons/          # War stories — specific issues and their resolutions
```

## Contributing

Each project that encounters deployment issues should add its lessons to `lessons/` using the template in `lessons/TEMPLATE.md`.
