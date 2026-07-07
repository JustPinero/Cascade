import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

// Fallback aligned with prisma.config.ts and lib/db.ts. Canonical
// SQLite file lives at the project root (./dev.db), not under prisma/.
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

const prisma = new PrismaClient({ adapter });

interface TemplateDef {
  name: string;
  description: string;
  filename: string;
  projectType: string;
  isDefault: boolean;
}

// Canonical v4.0 kickoff templates (synced from the KickoffPlaybook).
const templates: TemplateDef[] = [
  {
    name: "Universal v4.0",
    description:
      "Stack-agnostic kickoff template. All stack fields are [ASK ME] — Claude interviews you for every stack decision. The default starting point for any project.",
    filename: "universal-v4_0.md",
    projectType: "other",
    isDefault: true,
  },
  {
    name: "Web App v4.0",
    description:
      "Web-app variant pre-filled with the Coqui Labs house stack (Next.js App Router + TypeScript + Prisma + Vercel). Set any field back to [ASK ME] to trigger the stack interview.",
    filename: "web-app-v4_0.md",
    projectType: "web-app",
    isDefault: false,
  },
  {
    name: "API Service v4.0",
    description:
      "Headless API service variant with pre-filled defaults (FastAPI / Python / PostgreSQL / Railway). Remaining [ASK ME] fields trigger the stack interview.",
    filename: "api-service-v4_0.md",
    projectType: "api",
    isDefault: false,
  },
  {
    name: "Mobile App v4.0",
    description:
      "Mobile-app variant with sensible mobile defaults (Expo, TypeScript, Supabase). Override any default; [ASK ME] fields trigger the stack interview.",
    filename: "mobile-app-v4_0.md",
    projectType: "mobile",
    isDefault: false,
  },
  {
    name: "Site Rebuild v4.0",
    description:
      "Client site-rebuild variant: audit an existing site, preserve SEO/content, rebuild on a modern stack. Confirm pre-filled defaults per client.",
    filename: "site-rebuild-v4_0.md",
    projectType: "web-app",
    isDefault: false,
  },
  {
    name: "Game Dev v4.0",
    description:
      "Game-dev variant with Godot 4 / GDScript / desktop-export defaults and game-specific guidance. Set fields back to [ASK ME] to trigger the stack interview.",
    filename: "game-dev-v4_0.md",
    projectType: "game",
    isDefault: false,
  },
];

async function main() {
  for (const tmpl of templates) {
    const templatePath = path.resolve(__dirname, "../templates", tmpl.filename);
    const content = fs.readFileSync(templatePath, "utf-8");

    await prisma.kickoffTemplate.upsert({
      where: { id: templates.indexOf(tmpl) + 1 },
      update: {
        content,
        name: tmpl.name,
        description: tmpl.description,
        projectType: tmpl.projectType,
        isDefault: tmpl.isDefault,
      },
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
