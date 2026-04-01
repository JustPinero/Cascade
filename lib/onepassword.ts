import { execFileSync, execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { sanitizeForShell } from "./validators";

export interface EnvVarStatus {
  name: string;
  expected: boolean;
  inVault: boolean;
}

/**
 * Check if the op CLI is authenticated.
 */
export function isOpAuthenticated(): boolean {
  try {
    execSync("op account list", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read expected env vars from a project's .env.example file.
 */
export async function readExpectedVars(
  projectPath: string
): Promise<string[]> {
  const envExamplePath = path.join(projectPath, ".env.example");
  try {
    const content = await fs.readFile(envExamplePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => line.split("=")[0].trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check which env vars exist in a 1Password vault item.
 */
export function checkVaultItem(
  vaultName: string,
  itemName: string,
  expectedVars: string[]
): EnvVarStatus[] {
  try {
    const output = execFileSync(
      "op",
      ["item", "get", itemName, "--vault", vaultName, "--format", "json"],
      { stdio: "pipe", timeout: 10000 }
    ).toString();

    const item = JSON.parse(output);
    const fields = (item.fields || []) as { label: string; value: string }[];
    const fieldMap = new Map(fields.map((f) => [f.label, f.value]));

    return expectedVars.map((name) => ({
      name,
      expected: true,
      inVault: fieldMap.has(name),
    }));
  } catch {
    return expectedVars.map((name) => ({
      name,
      expected: true,
      inVault: false,
    }));
  }
}

/**
 * Create a 1Password item with env var fields for a project.
 */
export function createVaultItem(
  vaultName: string,
  itemName: string,
  vars: Record<string, string>
): { success: boolean; error: string | null } {
  try {
    // Check if item already exists
    try {
      execFileSync(
        "op",
        ["item", "get", itemName, "--vault", vaultName, "--format", "json"],
        { stdio: "pipe", timeout: 10000 }
      );
      return { success: true, error: null };
    } catch {
      // Doesn't exist, create it
    }

    const args = [
      "item",
      "create",
      "--category=login",
      `--title=${sanitizeForShell(itemName)}`,
      `--vault=${sanitizeForShell(vaultName)}`,
    ];

    for (const [key, val] of Object.entries(vars)) {
      args.push(`${sanitizeForShell(key)}[text]=${sanitizeForShell(val)}`);
    }

    execFileSync("op", args, { stdio: "pipe", timeout: 10000 });

    return { success: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Populate a .env.local file from 1Password vault item fields.
 */
export async function populateEnvLocal(
  projectPath: string,
  vaultName: string,
  itemName: string,
  vars: string[]
): Promise<{ populated: number; missing: string[] }> {
  const missing: string[] = [];
  const lines: string[] = [];

  try {
    const output = execFileSync(
      "op",
      ["item", "get", itemName, "--vault", vaultName, "--format", "json"],
      { stdio: "pipe", timeout: 10000 }
    ).toString();

    const item = JSON.parse(output);
    const fields = (item.fields || []) as { label: string; value: string }[];
    const fieldMap = new Map(fields.map((f) => [f.label, f.value]));

    for (const varName of vars) {
      if (fieldMap.has(varName)) {
        lines.push(`${varName}=${fieldMap.get(varName)}`);
      } else {
        missing.push(varName);
      }
    }
  } catch {
    return { populated: 0, missing: vars };
  }

  if (lines.length > 0) {
    const envLocalPath = path.join(projectPath, ".env.local");
    await fs.writeFile(envLocalPath, lines.join("\n") + "\n", "utf-8");
  }

  return { populated: lines.length, missing };
}
