import { describe, it, expect } from "vitest";

describe("notify module", () => {
  it("exports expected functions", async () => {
    const mod = await import("./notify");
    expect(typeof mod.canNotify).toBe("function");
    expect(typeof mod.sendNotification).toBe("function");
    expect(typeof mod.requestNotificationPermission).toBe("function");
    expect(typeof mod.isNotificationSupported).toBe("function");
    expect(typeof mod.getNotificationPreference).toBe("function");
    expect(typeof mod.setNotificationPreference).toBe("function");
  });

  it("canNotify returns false in Node environment", async () => {
    const { canNotify } = await import("./notify");
    // No window.Notification in Node
    expect(canNotify()).toBe(false);
  });

  it("isNotificationSupported returns false in Node environment", async () => {
    const { isNotificationSupported } = await import("./notify");
    expect(isNotificationSupported()).toBe(false);
  });

  it("requestNotificationPermission returns false in Node environment", async () => {
    const { requestNotificationPermission } = await import("./notify");
    const result = await requestNotificationPermission();
    expect(result).toBe(false);
  });

  it("sendNotification does not throw in Node environment", async () => {
    const { sendNotification } = await import("./notify");
    expect(() => sendNotification("Test")).not.toThrow();
  });

  it("getNotificationPreference defaults to true in Node", async () => {
    const { getNotificationPreference } = await import("./notify");
    // typeof window === "undefined" → returns true (default)
    expect(getNotificationPreference()).toBe(true);
  });
});
