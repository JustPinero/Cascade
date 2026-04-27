import { prisma } from "@/lib/db";
import { scanForOrphans } from "@/lib/migration-repair";
import { resolveProjectsDir } from "@/lib/validators";
import { unstable_cache } from "next/cache";
import { OrphanBanner } from "./orphan-banner";

const getOrphanCount = unstable_cache(
  async () => {
    try {
      const projectsDir = resolveProjectsDir();
      const orphans = await scanForOrphans(prisma, { projectsDir });
      return orphans.length;
    } catch {
      return 0;
    }
  },
  ["orphan-count"],
  { revalidate: 60 }
);

export async function OrphanBannerServer() {
  const count = await getOrphanCount();
  return <OrphanBanner count={count} />;
}
