import { describe, it, expect } from "vitest";
import { getLoginCommand, type CLIService } from "./cli-auth";

describe("getLoginCommand", () => {
  it("returns correct login command for vercel", () => {
    expect(getLoginCommand("vercel")).toBe("vercel login");
  });

  it("returns correct login command for github", () => {
    expect(getLoginCommand("github")).toBe("gh auth login");
  });

  it("returns correct login command for railway", () => {
    expect(getLoginCommand("railway")).toBe("railway login");
  });

  it("returns correct login command for 1password", () => {
    expect(getLoginCommand("1password")).toBe("eval $(op signin)");
  });

  it("returns all supported services", () => {
    const services: CLIService[] = ["vercel", "github", "railway", "1password"];
    for (const s of services) {
      expect(getLoginCommand(s)).toBeTruthy();
    }
  });
});
