import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

interface TemplateDef {
  name: string;
  description: string;
  filename: string;
  projectType: string;
  isDefault: boolean;
}

const templates: TemplateDef[] = [
  {
    name: "Web App v3.3",
    description:
      "Universal kickoff template for web applications. All sections with [ASK ME] markers for Claude interview.",
    filename: "web-app-v3.3.md",
    projectType: "web-app",
    isDefault: true,
  },
  {
    name: "RatRacer — Job Search Automation",
    description:
      "Filled example: Next.js + Supabase job search app with Claude API, scraping, and resume tailoring.",
    filename: "ratracer-v3.md",
    projectType: "web-app",
    isDefault: false,
  },
  {
    name: "Pyrrhic Victory — 2D Game",
    description:
      "Game dev template: Godot 4 + GDScript turn-based tactical arena with pixel art.",
    filename: "game-dev-v1.md",
    projectType: "game",
    isDefault: false,
  },
  {
    name: "InterviewIQ — API Service",
    description:
      "Headless API service: Python FastAPI with audio processing, ML pipelines, and async jobs.",
    filename: "api-service-v3.md",
    projectType: "api",
    isDefault: false,
  },
  {
    name: "PointPartner — Fintech App",
    description:
      "Web app with scraping, competitive analysis, Stripe payments, and Supabase RLS.",
    filename: "fintech-app-v3.md",
    projectType: "web-app",
    isDefault: false,
  },
  {
    name: "SiteLift — Site Rebuild",
    description:
      "Full site rebuild template with business workflow, design system, and content migration.",
    filename: "site-rebuild-v1.md",
    projectType: "web-app",
    isDefault: false,
  },
];

async function main() {
  for (const tmpl of templates) {
    const templatePath = path.resolve(__dirname, "../templates", tmpl.filename);
    const content = fs.readFileSync(templatePath, "utf-8");

    await prisma.kickoffTemplate.upsert({
      where: { id: templates.indexOf(tmpl) + 1 },
      update: { content, name: tmpl.name, description: tmpl.description },
      create: {
        name: tmpl.name,
        projectType: tmpl.projectType,
        isDefault: tmpl.isDefault,
        description: tmpl.description,
        content,
      },
    });

    console.log(`Seeded template: ${tmpl.name}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
