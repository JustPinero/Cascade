import fs from "fs/promises";
import path from "path";

export interface ProgressResult {
  phases: {
    completed: number;
    total: number;
    score: number;
  };
  tests: {
    fileCount: number;
    score: number;
  };
  readiness: {
    hasTypeCheck: boolean;
    hasLint: boolean;
    hasBuild: boolean;
    score: number;
  };
  total: number;
  scannedAt: string;
}

const MAX_PHASE_SCORE = 50;
const MAX_TEST_SCORE = 25;

// Points per build readiness check
const TYPECHECK_PTS = 10;
const LINT_PTS = 8;
const BUILD_PTS = 7;

// Test file count that earns max score (diminishing returns past this)
const TEST_FILE_CEILING = 20;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether requests/ uses phase-based folders or flat sequential files.
 * Returns "phased" if any entry starts with "phase-", "flat" if files exist, or "empty".
 */
async function detectRequestStructure(
  requestsDir: string
): Promise<"phased" | "flat" | "empty"> {
  try {
    const entries = await fs.readdir(requestsDir, { withFileTypes: true });
    const hasPhaseDir = entries.some(
      (e) => e.isDirectory() && e.name.startsWith("phase-")
    );
    if (hasPhaseDir) return "phased";
    const hasFiles = entries.some((e) => e.isFile() && e.name.endsWith(".md"));
    return hasFiles ? "flat" : "empty";
  } catch {
    return "empty";
  }
}

/**
 * Extract the numeric prefix from a request filename.
 * Handles: "1.1-scaffold.md" → "1.1", "001-setup.md" → "001", "007A-foo.md" → "007"
 */
function extractRequestNumber(filename: string): string {
  const match = filename.match(/^(\d[\d.A-Za-z]*)/);
  return match ? match[1].replace(/[A-Za-z]+$/, "") : "";
}

/**
 * Extract phase number from a phase directory name.
 * "phase-2-dashboard" → 2
 */
function extractPhaseNumber(phaseName: string): number {
  const match = phaseName.match(/phase-(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * Score phase completion for phase-based project structures.
 */
async function scorePhasedRequests(
  requestsDir: string,
  currentPhase: string,
  currentRequest: string | null
): Promise<{ completed: number; total: number }> {
  const entries = await fs.readdir(requestsDir, { withFileTypes: true });
  const phaseDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("phase-"))
    .map((e) => e.name)
    .sort();

  const currentPhaseNum = extractPhaseNumber(currentPhase);
  let total = 0;
  let completed = 0;

  for (const phaseDir of phaseDirs) {
    const phaseNum = extractPhaseNumber(phaseDir);
    const phaseFiles = (await fs.readdir(path.join(requestsDir, phaseDir)))
      .filter((f) => f.endsWith(".md"))
      .sort();

    total += phaseFiles.length;

    if (phaseNum < currentPhaseNum) {
      // Entire phase is completed
      completed += phaseFiles.length;
    } else if (phaseNum === currentPhaseNum && currentRequest) {
      // Within current phase, count requests before the current one
      for (const file of phaseFiles) {
        const reqNum = extractRequestNumber(file);
        if (reqNum < currentRequest) {
          completed++;
        }
      }
    }
    // Phases after currentPhase: nothing completed
  }

  return { completed, total };
}

/**
 * Score phase completion for flat sequential request structures.
 */
async function scoreFlatRequests(
  requestsDir: string,
  currentRequest: string | null
): Promise<{ completed: number; total: number }> {
  const files = (await fs.readdir(requestsDir))
    .filter((f) => f.endsWith(".md"))
    .sort();

  const total = files.length;

  if (!currentRequest) {
    return { completed: 0, total };
  }

  // Extract numeric prefix from currentRequest (could be "003" or "003-api")
  const currentNum = currentRequest.replace(/[^0-9]/g, "").replace(/^0+/, "");

  let completed = 0;
  for (const file of files) {
    const fileNum = extractRequestNumber(file).replace(/^0+/, "");
    if (fileNum && currentNum && parseInt(fileNum) < parseInt(currentNum)) {
      completed++;
    }
  }

  // Cap at total
  return { completed: Math.min(completed, total), total };
}

/**
 * Count test files recursively in a project directory.
 */
async function countTestFiles(projectPath: string): Promise<number> {
  let count = 0;

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (
          /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)
        ) {
          count++;
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await walk(projectPath);
  return count;
}

/**
 * Check package.json for build-related scripts.
 */
async function detectBuildScripts(
  projectPath: string
): Promise<{ hasTypeCheck: boolean; hasLint: boolean; hasBuild: boolean }> {
  try {
    const pkgContent = await fs.readFile(
      path.join(projectPath, "package.json"),
      "utf-8"
    );
    const pkg = JSON.parse(pkgContent);
    const scripts = pkg.scripts || {};
    const allScriptValues = Object.values(scripts).join(" ");

    return {
      hasTypeCheck: allScriptValues.includes("tsc"),
      hasLint:
        allScriptValues.includes("eslint") ||
        allScriptValues.includes("lint"),
      hasBuild:
        "build" in scripts ||
        allScriptValues.includes("next build") ||
        allScriptValues.includes("vite build"),
    };
  } catch {
    return { hasTypeCheck: false, hasLint: false, hasBuild: false };
  }
}

/**
 * Compute progress score for a project.
 *
 * Scoring:
 * - Phase completion: 50 pts (proportional to completed/total requests)
 * - Test health: 25 pts (based on test file count, capped at ceiling)
 * - Build readiness: 25 pts (10 typecheck + 8 lint + 7 build script existence)
 */
export async function computeProgress(
  projectPath: string,
  currentPhase: string,
  currentRequest: string | null
): Promise<ProgressResult> {
  const empty: ProgressResult = {
    phases: { completed: 0, total: 0, score: 0 },
    tests: { fileCount: 0, score: 0 },
    readiness: { hasTypeCheck: false, hasLint: false, hasBuild: false, score: 0 },
    total: 0,
    scannedAt: new Date().toISOString(),
  };

  if (!(await exists(projectPath))) {
    return empty;
  }

  // Phase completion (50 pts)
  const requestsDir = path.join(projectPath, "requests");
  let phaseResult = { completed: 0, total: 0 };

  const structure = await detectRequestStructure(requestsDir);
  if (structure === "phased") {
    phaseResult = await scorePhasedRequests(
      requestsDir,
      currentPhase,
      currentRequest
    );
  } else if (structure === "flat") {
    phaseResult = await scoreFlatRequests(requestsDir, currentRequest);
  }

  const phaseScore =
    phaseResult.total > 0
      ? Math.round((phaseResult.completed / phaseResult.total) * MAX_PHASE_SCORE)
      : 0;

  // Test health (25 pts)
  const testFileCount = await countTestFiles(projectPath);
  const testScore = Math.min(
    Math.round((testFileCount / TEST_FILE_CEILING) * MAX_TEST_SCORE),
    MAX_TEST_SCORE
  );

  // Build readiness (25 pts)
  const buildScripts = await detectBuildScripts(projectPath);
  const readinessScore =
    (buildScripts.hasTypeCheck ? TYPECHECK_PTS : 0) +
    (buildScripts.hasLint ? LINT_PTS : 0) +
    (buildScripts.hasBuild ? BUILD_PTS : 0);

  const total = phaseScore + testScore + readinessScore;

  return {
    phases: { completed: phaseResult.completed, total: phaseResult.total, score: phaseScore },
    tests: { fileCount: testFileCount, score: testScore },
    readiness: { ...buildScripts, score: readinessScore },
    total,
    scannedAt: new Date().toISOString(),
  };
}
