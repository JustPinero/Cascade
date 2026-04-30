import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOverseerSettings,
  setOverseerSettings,
  getPortraitMode,
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
      // Default talking portrait set to the bundled asset in the
      // portrait-settings fix so the dual-face flip works out of the
      // box. Users opt OUT of dual via the settings UI.
      const settings = getOverseerSettings();
      expect(settings.name).toBe("Overseer");
      expect(settings.portraitIdle).toBe("/delamain.jpg");
      expect(settings.portraitTalking).toBe("/delamain-talking.jpg");
      // Phase 20 — voice off by default; users opt in.
      expect(settings.voiceEnabled).toBe(false);
      expect(settings.voiceURI).toBeNull();
      expect(settings.voiceRate).toBe(1.0);
      expect(settings.voicePitch).toBe(1.0);
      // Phase 21 — talking face on by default; mic toggle is the
      // existing behavior; silence threshold 1500ms.
      expect(settings.usesTalkingFace).toBe(true);
      expect(settings.silenceThresholdMs).toBe(1500);
      expect(settings.micMode).toBe("toggle");
    });

    it("round-trips voice preferences (Phase 20)", () => {
      setOverseerSettings({
        voiceEnabled: true,
        voiceURI: "samantha",
        voiceRate: 1.25,
        voicePitch: 0.9,
      });
      const settings = getOverseerSettings();
      expect(settings.voiceEnabled).toBe(true);
      expect(settings.voiceURI).toBe("samantha");
      expect(settings.voiceRate).toBe(1.25);
      expect(settings.voicePitch).toBe(0.9);
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

    it("returns dual with defaults (talking portrait now ships by default)", () => {
      expect(getPortraitMode()).toBe("dual");
    });

    it("returns single when usesTalkingFace is false (Phase 21)", () => {
      setOverseerSettings({
        portraitIdle: "/idle.jpg",
        portraitTalking: "/talking.jpg",
        usesTalkingFace: false,
      });
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
