import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOverseerSettings,
  setOverseerSettings,
  getPortraitMode,
  type OverseerSettings,
} from "./overseer-settings";

const store: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};

beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  vi.stubGlobal("window", { localStorage: mockStorage });
  vi.stubGlobal("localStorage", mockStorage);
});

describe("overseer-settings", () => {
  describe("getOverseerSettings", () => {
    it("returns defaults when no preference set", () => {
      const settings = getOverseerSettings();
      expect(settings.name).toBe("Overseer");
      expect(settings.portraitIdle).toBe("/delamain.jpg");
      expect(settings.portraitTalking).toBeNull();
    });

    it("returns custom name after setting", () => {
      setOverseerSettings({ name: "Cortana" });
      const settings = getOverseerSettings();
      expect(settings.name).toBe("Cortana");
    });

    it("returns custom portrait paths after setting", () => {
      setOverseerSettings({
        portraitIdle: "/overseer/custom-idle.jpg",
        portraitTalking: "/overseer/custom-talking.jpg",
      });
      const settings = getOverseerSettings();
      expect(settings.portraitIdle).toBe("/overseer/custom-idle.jpg");
      expect(settings.portraitTalking).toBe("/overseer/custom-talking.jpg");
    });

    it("preserves existing settings on partial update", () => {
      setOverseerSettings({ name: "SHODAN", portraitIdle: "/custom.jpg" });
      setOverseerSettings({ name: "GLaDOS" });
      const settings = getOverseerSettings();
      expect(settings.name).toBe("GLaDOS");
      expect(settings.portraitIdle).toBe("/custom.jpg");
    });
  });

  describe("getPortraitMode", () => {
    it("returns single when no talking image set", () => {
      setOverseerSettings({ portraitIdle: "/idle.jpg", portraitTalking: null });
      expect(getPortraitMode()).toBe("single");
    });

    it("returns dual when both images set", () => {
      setOverseerSettings({
        portraitIdle: "/idle.jpg",
        portraitTalking: "/talking.jpg",
      });
      expect(getPortraitMode()).toBe("dual");
    });

    it("returns single with defaults", () => {
      expect(getPortraitMode()).toBe("single");
    });
  });

  describe("setOverseerSettings", () => {
    it("persists to localStorage under cascade-overseer key", () => {
      setOverseerSettings({ name: "HAL 9000" });
      expect(store["cascade-overseer"]).toBeDefined();
      const parsed = JSON.parse(store["cascade-overseer"]);
      expect(parsed.name).toBe("HAL 9000");
    });
  });
});
