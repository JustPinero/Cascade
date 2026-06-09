export interface DeploymentStatus {
  platform: "vercel" | "railway" | "unknown";
  state: "deployed" | "building" | "failed" | "unknown";
  url: string | null;
  updatedAt: string;
}

// In-memory cache to avoid rate limits
const statusCache = new Map<
  string,
  { status: DeploymentStatus; cachedAt: number }
>();
const CACHE_TTL_MS = 60_000; // 1 minute
// Phase 31 — audit finding [30.D7]. Without this, a hung remote
// stalled `/api/integrations/deploy-status` until Node's default
// socket timeout (~minutes).
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Get deployment status for a Vercel project.
 */
async function getVercelStatus(
  projectId: string,
  token: string
): Promise<DeploymentStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return {
        platform: "vercel",
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }

    const data = await res.json();
    const deployment = data.deployments?.[0];

    if (!deployment) {
      return {
        platform: "vercel",
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }

    const stateMap: Record<string, DeploymentStatus["state"]> = {
      READY: "deployed",
      BUILDING: "building",
      ERROR: "failed",
      CANCELED: "failed",
    };

    return {
      platform: "vercel",
      state: stateMap[deployment.state] || "unknown",
      url: deployment.url ? `https://${deployment.url}` : null,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      platform: "vercel",
      state: "unknown",
      url: null,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get deployment status for a Railway project.
 */
async function getRailwayStatus(
  projectId: string,
  token: string
): Promise<DeploymentStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query ($id: String!) { project(id: $id) { deployments(first: 1) { edges { node { status } } } } }`,
        variables: { id: projectId },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        platform: "railway",
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }

    const data = await res.json();
    const deployment =
      data?.data?.project?.deployments?.edges?.[0]?.node;

    if (!deployment) {
      return {
        platform: "railway",
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }

    const stateMap: Record<string, DeploymentStatus["state"]> = {
      SUCCESS: "deployed",
      BUILDING: "building",
      DEPLOYING: "building",
      FAILED: "failed",
      CRASHED: "failed",
    };

    return {
      platform: "railway",
      state: stateMap[deployment.status] || "unknown",
      url: null,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      platform: "railway",
      state: "unknown",
      url: null,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get deployment status with caching.
 */
export async function getDeploymentStatus(
  platform: "vercel" | "railway",
  projectId: string
): Promise<DeploymentStatus> {
  const cacheKey = `${platform}:${projectId}`;
  const cached = statusCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  let status: DeploymentStatus;

  if (platform === "vercel") {
    const token = process.env.VERCEL_TOKEN;
    if (!token) {
      return {
        platform,
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }
    status = await getVercelStatus(projectId, token);
  } else {
    const token = process.env.RAILWAY_TOKEN;
    if (!token) {
      return {
        platform,
        state: "unknown",
        url: null,
        updatedAt: new Date().toISOString(),
      };
    }
    status = await getRailwayStatus(projectId, token);
  }

  statusCache.set(cacheKey, { status, cachedAt: Date.now() });
  return status;
}

/**
 * Clear the status cache.
 */
export function clearDeployCache(): void {
  statusCache.clear();
}
