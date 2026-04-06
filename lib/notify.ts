/**
 * Browser desktop notification utility.
 * Wraps the Notification API with permission handling.
 */

/**
 * Check if notifications are supported and enabled.
 */
export function canNotify(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (localStorage.getItem("cascade-notifications") === "false") return false;
  return Notification.permission === "granted";
}

/**
 * Request notification permission from the browser.
 * Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Check if notifications are supported by the browser.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Get current notification preference from localStorage.
 */
export function getNotificationPreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("cascade-notifications") !== "false";
}

/**
 * Set notification preference in localStorage.
 */
export function setNotificationPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("cascade-notifications", String(enabled));
}

/**
 * Send a desktop notification if permitted.
 */
export function sendNotification(
  title: string,
  options?: { body?: string; tag?: string }
): void {
  if (!canNotify()) return;

  try {
    new Notification(title, {
      body: options?.body,
      tag: options?.tag, // prevents duplicate notifications with same tag
      icon: "/favicon.ico",
    });
  } catch {
    // Notification constructor can throw in some environments
  }
}
