import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const defaultTemplate = await prisma.kickoffTemplate.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: "Web App v3.3",
      projectType: "web-app",
      isDefault: true,
      description: "Standard web application kickoff template",
      content: "See templates/web-app-v3.3.md for full content",
    },
  });

  console.log("Seeded default kickoff template:", defaultTemplate.name);
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
