import fs from "fs/promises";
import path from "path";

export interface RequestItem {
  number: string;
  title: string;
  filename: string;
  status: "done" | "current" | "upcoming";
}

export interface PhaseInfo {
  name: string;
  label: string;
  isCurrent: boolean;
  requests: RequestItem[];
}

export interface RemainingWork {
  type: "phased" | "flat" | "empty";
  phases: PhaseInfo[];
  totalRequests: number;
  completedRequests: number;
  remainingRequests: number;
}

/**
 * Extract a readable title from a request filename.
 * "1.1-nextjs-scaffold.md" → "Nextjs Scaffold"
 * "001-monorepo-setup.md" → "Monorepo Setup"
 */
function extractTitle(filename: string): string {
  return filename
    .replace(/\.md$/, "")
    .replace(/^[\d.]+[A-Za-z]?-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract the numeric prefix from a request filename.
 * "1.1-scaffold.md" → "1.1"
 * "001-setup.md" → "001"
 */
function extractNumber(filename: string): string {
  const match = filename.match(/^(\d[\d.]*)/);
  return match ? match[1] : "";
}

/**
 * Extract phase number from a phase directory name.
 */
function extractPhaseNumber(phaseName: string): number {
  const match = phaseName.match(/phase-(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * Format a phase directory name into a readable label.
 * "phase-2-dashboard" → "Phase 2 — Dashboard"
 */
function formatPhaseLabel(phaseName: string): string {
  const match = phaseName.match(/phase-(\d+)-?(.*)/);
  if (!match) return phaseName;
  const num = match[1];
  const desc = match[2]
    ? match[2].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
  return desc ? `Phase ${num} — ${desc}` : `Phase ${num}`;
}

/**
 * Read the requests/ directory and return structured remaining work.
 */
export async function getRemainingWork(
  projectPath: string,
  currentPhase: string,
  currentRequest: string | null
): Promise<RemainingWork> {
  const requestsDir = path.join(projectPath, "requests");

  try {
    await fs.access(requestsDir);
  } catch {
    return {
      type: "empty",
      phases: [],
      totalRequests: 0,
      completedRequests: 0,
      remainingRequests: 0,
    };
  }

  const entries = await fs.readdir(requestsDir, { withFileTypes: true });
  const hasPhaseDir = entries.some(
    (e) => e.isDirectory() && e.name.startsWith("phase-")
  );

  if (hasPhaseDir) {
    return buildPhasedWork(requestsDir, currentPhase, currentRequest);
  }

  const hasFiles = entries.some((e) => e.isFile() && e.name.endsWith(".md"));
  if (hasFiles) {
    return buildFlatWork(requestsDir, currentRequest);
  }

  return {
    type: "empty",
    phases: [],
    totalRequests: 0,
    completedRequests: 0,
    remainingRequests: 0,
  };
}

async function buildPhasedWork(
  requestsDir: string,
  currentPhase: string,
  currentRequest: string | null
): Promise<RemainingWork> {
  const entries = await fs.readdir(requestsDir, { withFileTypes: true });
  const phaseDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("phase-"))
    .map((e) => e.name)
    .sort();

  const currentPhaseNum = extractPhaseNumber(currentPhase);
  const phases: PhaseInfo[] = [];
  let totalRequests = 0;
  let completedRequests = 0;

  for (const phaseDir of phaseDirs) {
    const phaseNum = extractPhaseNumber(phaseDir);
    const phaseFiles = (
      await fs.readdir(path.join(requestsDir, phaseDir))
    )
      .filter((f) => f.endsWith(".md"))
      .sort();

    const isCurrent = phaseNum === currentPhaseNum;
    const requests: RequestItem[] = [];

    for (const file of phaseFiles) {
      const reqNum = extractNumber(file);
      let status: RequestItem["status"];

      if (phaseNum < currentPhaseNum) {
        status = "done";
        completedRequests++;
      } else if (phaseNum === currentPhaseNum) {
        if (currentRequest && reqNum < currentRequest) {
          status = "done";
          completedRequests++;
        } else if (currentRequest && reqNum === currentRequest) {
          status = "current";
        } else if (!currentRequest && reqNum === extractNumber(phaseFiles[0])) {
          // No current request, mark first in current phase as current
          status = "current";
        } else if (!currentRequest) {
          status = "upcoming";
        } else {
          status = "upcoming";
        }
      } else {
        status = "upcoming";
      }

      requests.push({
        number: reqNum,
        title: extractTitle(file),
        filename: file,
        status,
      });
      totalRequests++;
    }

    phases.push({
      name: phaseDir,
      label: formatPhaseLabel(phaseDir),
      isCurrent,
      requests,
    });
  }

  const remainingRequests = totalRequests - completedRequests - 1; // -1 for current

  return {
    type: "phased",
    phases,
    totalRequests,
    completedRequests,
    remainingRequests: Math.max(0, remainingRequests),
  };
}

async function buildFlatWork(
  requestsDir: string,
  currentRequest: string | null
): Promise<RemainingWork> {
  const files = (await fs.readdir(requestsDir))
    .filter((f) => f.endsWith(".md"))
    .sort();

  const currentNum = currentRequest
    ? currentRequest.replace(/[^0-9]/g, "").replace(/^0+/, "")
    : null;

  const requests: RequestItem[] = [];
  let completedRequests = 0;

  for (const file of files) {
    const reqNum = extractNumber(file);
    const numericReq = reqNum.replace(/^0+/, "");
    let status: RequestItem["status"];

    if (currentNum && parseInt(numericReq) < parseInt(currentNum)) {
      status = "done";
      completedRequests++;
    } else if (currentNum && numericReq === currentNum) {
      status = "current";
    } else if (!currentNum && file === files[0]) {
      status = "current";
    } else {
      status = "upcoming";
    }

    requests.push({
      number: reqNum,
      title: extractTitle(file),
      filename: file,
      status,
    });
  }

  const remainingRequests = files.length - completedRequests - 1;

  return {
    type: "flat",
    phases: [
      {
        name: "requests",
        label: "Requests",
        isCurrent: true,
        requests,
      },
    ],
    totalRequests: files.length,
    completedRequests,
    remainingRequests: Math.max(0, remainingRequests),
  };
}
