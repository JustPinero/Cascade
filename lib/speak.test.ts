/**
 * Phase 20.1 — speak() wraps speechSynthesis. Tests use a mock
 * because vitest's "node" environment has no browser API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Utterance = {
  text: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
};

interface MockSpeechSynthesis {
  speak: (u: Utterance) => void;
  cancel: () => void;
  getVoices: () => SpeechSynthesisVoice[];
  speaking: boolean;
}

let mockUtterances: Utterance[];
let mockSynth: MockSpeechSynthesis;
let mockVoices: SpeechSynthesisVoice[];

beforeEach(() => {
  mockUtterances = [];
  mockVoices = [
    {
      name: "Samantha",
      voiceURI: "samantha",
      lang: "en-US",
      localService: true,
      default: true,
    } as SpeechSynthesisVoice,
    {
      name: "Daniel",
      voiceURI: "daniel",
      lang: "en-GB",
      localService: true,
      default: false,
    } as SpeechSynthesisVoice,
  ];
  mockSynth = {
    speak: vi.fn((u: Utterance) => {
      mockUtterances.push(u);
    }),
    cancel: vi.fn(),
    getVoices: vi.fn(() => mockVoices),
    speaking: false,
  };

  (globalThis as unknown as { window: object }).window = {
    speechSynthesis: mockSynth,
    SpeechSynthesisUtterance: class {
      text: string;
      voice: SpeechSynthesisVoice | null = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("speak", () => {
  it("does nothing when text is empty", async () => {
    const { speak } = await import("@/lib/speak");
    speak("", { voiceEnabled: true, voiceURI: null, voiceRate: 1, voicePitch: 1 });
    expect(mockSynth.speak).not.toHaveBeenCalled();
  });

  it("does nothing when voiceEnabled is false", async () => {
    const { speak } = await import("@/lib/speak");
    speak("hello", {
      voiceEnabled: false,
      voiceURI: null,
      voiceRate: 1,
      voicePitch: 1,
    });
    expect(mockSynth.speak).not.toHaveBeenCalled();
  });

  it("speaks the text when voiceEnabled is true", async () => {
    const { speak } = await import("@/lib/speak");
    speak("hello world", {
      voiceEnabled: true,
      voiceURI: null,
      voiceRate: 1,
      voicePitch: 1,
    });
    expect(mockSynth.speak).toHaveBeenCalledTimes(1);
    expect(mockUtterances[0].text).toBe("hello world");
  });

  it("applies rate, pitch, and selected voice URI", async () => {
    const { speak } = await import("@/lib/speak");
    speak("test", {
      voiceEnabled: true,
      voiceURI: "daniel",
      voiceRate: 1.5,
      voicePitch: 0.8,
    });
    const u = mockUtterances[0];
    expect(u.rate).toBe(1.5);
    expect(u.pitch).toBe(0.8);
    expect(u.voice?.voiceURI).toBe("daniel");
  });

  it("falls back to no voice override when voiceURI doesn't match a known voice", async () => {
    const { speak } = await import("@/lib/speak");
    speak("test", {
      voiceEnabled: true,
      voiceURI: "nonexistent-voice",
      voiceRate: 1,
      voicePitch: 1,
    });
    expect(mockUtterances[0].voice).toBeNull();
  });

  it("clamps rate and pitch to safe browser ranges", async () => {
    const { speak } = await import("@/lib/speak");
    speak("test", {
      voiceEnabled: true,
      voiceURI: null,
      voiceRate: 99,
      voicePitch: -5,
    });
    const u = mockUtterances[0];
    expect(u.rate).toBeLessThanOrEqual(2);
    expect(u.pitch).toBeGreaterThanOrEqual(0);
  });

  it("invokes onComplete callback after onend fires", async () => {
    const { speak } = await import("@/lib/speak");
    const done = vi.fn();
    speak("text", {
      voiceEnabled: true,
      voiceURI: null,
      voiceRate: 1,
      voicePitch: 1,
      onComplete: done,
    });
    mockUtterances[0].onend?.();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("cancel", () => {
  it("calls speechSynthesis.cancel()", async () => {
    const { cancel } = await import("@/lib/speak");
    cancel();
    expect(mockSynth.cancel).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when speechSynthesis is unavailable (server-side)", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const { cancel } = await import("@/lib/speak");
    expect(() => cancel()).not.toThrow();
  });
});

describe("listVoices", () => {
  it("returns the browser's available voices", async () => {
    const { listVoices } = await import("@/lib/speak");
    const out = listVoices();
    expect(out.length).toBe(2);
    expect(out[0].name).toBe("Samantha");
  });

  it("returns [] when speechSynthesis is unavailable", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const { listVoices } = await import("@/lib/speak");
    expect(listVoices()).toEqual([]);
  });
});
