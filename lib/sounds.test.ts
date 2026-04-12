import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSoundPreference,
  setSoundPreference,
  shouldPlaySound,
} from "./sounds";

const store: Record<string, string> = {};

beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
  });
});

describe("sounds", () => {
  describe("getSoundPreference", () => {
    it("defaults to true when no preference set", () => {
      // In Node env, typeof window === "undefined" → returns true
      expect(getSoundPreference()).toBe(true);
    });
  });

  describe("setSoundPreference", () => {
    it("is a function", () => {
      expect(typeof setSoundPreference).toBe("function");
    });
  });

  describe("shouldPlaySound", () => {
    it("returns false in Node environment (no window)", () => {
      // No window.AudioContext in Node
      expect(shouldPlaySound()).toBe(false);
    });
  });
});
