/**
 * Platform detection and launch method selection.
 * Enables Cascade to work on macOS (native), Linux, and Windows (WSL2).
 */

export type Platform = "macos" | "linux" | "windows";
export type LaunchMethod = "osascript" | "tmux-direct";

/**
 * Detect the current platform.
 */
export function detectPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

/**
 * Get the appropriate terminal launch method for a platform.
 *
 * - macOS: osascript (opens Terminal.app via AppleScript)
 * - Linux/WSL2: tmux-direct (launches claude directly in tmux, no GUI terminal wrapper)
 */
export function getLaunchMethod(platform: Platform): LaunchMethod {
  if (platform === "macos") return "osascript";
  return "tmux-direct";
}
