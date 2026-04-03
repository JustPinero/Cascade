import { execSync, spawn } from "child_process";

export type CLIService = "vercel" | "github" | "railway" | "1password";

export interface AuthStatus {
  service: CLIService;
  label: string;
  installed: boolean;
  authenticated: boolean;
  user: string | null;
  error: string | null;
}

const SERVICE_CONFIG: Record<
  CLIService,
  {
    label: string;
    checkCmd: string;
    loginCmd: string;
    parseUser: (output: string) => string | null;
  }
> = {
  vercel: {
    label: "Vercel",
    checkCmd: "vercel whoami",
    loginCmd: "vercel login",
    parseUser: (output) => output.trim() || null,
  },
  github: {
    label: "GitHub CLI",
    checkCmd: "gh auth status",
    loginCmd: "gh auth login",
    parseUser: (output) => {
      const match = output.match(/Logged in to .* account (\S+)/i)
        || output.match(/account (\S+)/i);
      return match ? match[1] : "authenticated";
    },
  },
  railway: {
    label: "Railway",
    checkCmd: "railway whoami",
    loginCmd: "railway login",
    parseUser: (output) => output.trim() || null,
  },
  "1password": {
    label: "1Password CLI",
    checkCmd: "op account list --format=json",
    loginCmd: "eval $(op signin)",
    parseUser: (output) => {
      try {
        const accounts = JSON.parse(output);
        if (Array.isArray(accounts) && accounts.length > 0) {
          return accounts[0].email || accounts[0].shorthand || "authenticated";
        }
      } catch {
        // not json
      }
      return output.trim() ? "authenticated" : null;
    },
  },
};

/**
 * Get the login command for a CLI service.
 */
export function getLoginCommand(service: CLIService): string {
  return SERVICE_CONFIG[service].loginCmd;
}

/**
 * Check if a CLI tool is installed.
 */
function isInstalled(command: string): boolean {
  try {
    execSync(`which ${command.split(" ")[0]}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check auth status for a single CLI service.
 */
export function checkAuthStatus(service: CLIService): AuthStatus {
  const config = SERVICE_CONFIG[service];
  const cliName = config.checkCmd.split(" ")[0];

  if (!isInstalled(cliName)) {
    return {
      service,
      label: config.label,
      installed: false,
      authenticated: false,
      user: null,
      error: `${cliName} not installed`,
    };
  }

  try {
    const output = execSync(config.checkCmd, {
      stdio: "pipe",
      timeout: 10_000,
    }).toString();

    const user = config.parseUser(output);
    return {
      service,
      label: config.label,
      installed: true,
      authenticated: user !== null,
      user,
      error: null,
    };
  } catch (err) {
    // gh auth status exits with code 1 when not authenticated
    // but prints to stderr — check stderr too
    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = (err as { stderr: Buffer }).stderr?.toString() || "";
      if (stderr.includes("Logged in")) {
        const user = SERVICE_CONFIG[service].parseUser(stderr);
        return {
          service,
          label: config.label,
          installed: true,
          authenticated: true,
          user,
          error: null,
        };
      }
    }
    return {
      service,
      label: config.label,
      installed: true,
      authenticated: false,
      user: null,
      error: null,
    };
  }
}

/**
 * Check auth status for all CLI services.
 */
export function checkAllAuthStatuses(): AuthStatus[] {
  const services: CLIService[] = ["vercel", "github", "railway", "1password"];
  return services.map(checkAuthStatus);
}

/**
 * Launch a Terminal window with the login command for a service.
 */
export function launchLogin(service: CLIService): { success: boolean; error: string | null } {
  const config = SERVICE_CONFIG[service];

  try {
    const cmd = config.loginCmd.replace(/"/g, '\\"');
    const script = `
      tell application "Terminal"
        do script "${cmd}"
        activate
      end tell
    `;

    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { success: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
