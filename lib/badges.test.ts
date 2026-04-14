import { describe, it, expect } from "vitest";
import { validateBadges, VALID_BADGES, type Badge } from "./badges";

describe("badges", () => {
  describe("validateBadges", () => {
    it("accepts valid badges", () => {
      const result = validateBadges(["deployed", "client"]);
      expect(result).toEqual(["deployed", "client"]);
    });

    it("filters out invalid badges", () => {
      const result = validateBadges(["deployed", "nonsense", "client"]);
      expect(result).toEqual(["deployed", "client"]);
    });

    it("returns empty array for no valid badges", () => {
      const result = validateBadges(["fake", "invalid"]);
      expect(result).toEqual([]);
    });

    it("returns empty array for non-array input", () => {
      expect(validateBadges(null as unknown as string[])).toEqual([]);
      expect(validateBadges(undefined as unknown as string[])).toEqual([]);
      expect(validateBadges("deployed" as unknown as string[])).toEqual([]);
    });

    it("deduplicates badges", () => {
      const result = validateBadges(["deployed", "deployed", "client"]);
      expect(result).toEqual(["deployed", "client"]);
    });

    it("accepts all valid badge values", () => {
      const result = validateBadges([...VALID_BADGES]);
      expect(result).toHaveLength(VALID_BADGES.length);
    });
  });
});
