export interface DeployHealthResult {
  status: "healthy" | "down" | "skipped";
  url: string;
  statusCode: number | null;
  error: string | null;
  checkedAt: string;
}

/**
 * Check if a deployed URL is responding.
 * Returns healthy for 200, down for anything else, skipped if no URL.
 */
export async function checkDeployHealth(
  url: string
): Promise<DeployHealthResult> {
  if (!url || typeof url !== "string") {
    return {
      status: "skipped",
      url: "",
      statusCode: null,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      status: response.ok ? "healthy" : "down",
      url,
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "down",
      url,
      statusCode: null,
      error: err instanceof Error ? err.message : "Unknown error",
      checkedAt: new Date().toISOString(),
    };
  }
}
