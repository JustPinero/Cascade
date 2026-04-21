import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { execFileSync, execSync } from "child_process";
import {
  ensureCascadeVault,
  bootstrapCascadeRuntimeItem,
  resolveOpRef,
  assertOpReady,
} from "./onepassword";

describe("ensureCascadeVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the Cascade vault when it does not exist", () => {
    vi.mocked(execFileSync).mockImplementation(((
      _cmd: string,
      args?: readonly string[]
    ) => {
      if (args?.includes("list")) return Buffer.from("[]");
      return Buffer.from(JSON.stringify({ id: "v1" }));
    }) as typeof execFileSync);

    ensureCascadeVault();

    const createCall = vi
      .mocked(execFileSync)
      .mock.calls.find(
        (call) =>
          Array.isArray(call[1]) &&
          call[1].includes("create") &&
          call[1].includes("Cascade")
      );
    expect(createCall).toBeDefined();
  });

  it("is a no-op when the Cascade vault already exists", () => {
    vi.mocked(execFileSync).mockReturnValue(
      Buffer.from(JSON.stringify([{ name: "Cascade", id: "v1" }]))
    );

    ensureCascadeVault();

    const createCall = vi
      .mocked(execFileSync)
      .mock.calls.find(
        (call) => Array.isArray(call[1]) && call[1].includes("create")
      );
    expect(createCall).toBeUndefined();
  });
});

describe("bootstrapCascadeRuntimeItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a Cascade Runtime item with password-type secret fields", () => {
    vi.mocked(execFileSync).mockImplementation(((
      _cmd: string,
      args?: readonly string[]
    ) => {
      if (args?.includes("get")) {
        const err = new Error("not found");
        throw err;
      }
      return Buffer.from("{}");
    }) as typeof execFileSync);

    bootstrapCascadeRuntimeItem({
      anthropic_api_key: "sk-ant-xxx",
    });

    const createCall = vi
      .mocked(execFileSync)
      .mock.calls.find(
        (call) => Array.isArray(call[1]) && call[1].includes("create")
      );
    expect(createCall).toBeDefined();
    const fieldArg = (createCall![1] as string[]).find((a) =>
      a.startsWith("anthropic_api_key[password]=")
    );
    expect(fieldArg).toBe("anthropic_api_key[password]=sk-ant-xxx");
  });

  it("updates an existing Cascade Runtime item with new fields", () => {
    vi.mocked(execFileSync).mockImplementation(((
      _cmd: string,
      args?: readonly string[]
    ) => {
      if (args?.includes("get")) {
        return Buffer.from(JSON.stringify({ id: "item1" }));
      }
      return Buffer.from("{}");
    }) as typeof execFileSync);

    bootstrapCascadeRuntimeItem({
      anthropic_api_key: "sk-ant-new",
    });

    const editCall = vi
      .mocked(execFileSync)
      .mock.calls.find(
        (call) => Array.isArray(call[1]) && call[1].includes("edit")
      );
    expect(editCall).toBeDefined();
  });
});

describe("resolveOpRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the resolved value for a valid op:// reference", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("secret-value\n"));

    const value = resolveOpRef(
      "op://Cascade/Cascade Runtime/anthropic_api_key"
    );

    expect(value).toBe("secret-value");
    expect(execFileSync).toHaveBeenCalledWith(
      "op",
      ["read", "op://Cascade/Cascade Runtime/anthropic_api_key"],
      expect.any(Object)
    );
  });

  it("throws a descriptive error when op read fails", () => {
    vi.mocked(execFileSync).mockImplementation((() => {
      throw new Error("signin required");
    }) as typeof execFileSync);

    expect(() =>
      resolveOpRef("op://Cascade/Cascade Runtime/anthropic_api_key")
    ).toThrow(/op read failed/);
  });

  it("rejects strings that are not op:// references", () => {
    expect(() => resolveOpRef("not-a-ref")).toThrow(
      /not a valid op:\/\/ reference/
    );
  });
});

describe("assertOpReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when op is installed and authenticated", () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from("account info"));
    expect(() => assertOpReady()).not.toThrow();
  });

  it("throws with install instructions when op CLI is missing", () => {
    vi.mocked(execSync).mockImplementation((() => {
      const err = new Error("command not found") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }) as typeof execSync);

    expect(() => assertOpReady()).toThrow(/install the 1Password CLI/);
  });

  it("throws with signin instructions when op is not signed in", () => {
    vi.mocked(execSync).mockImplementation((() => {
      throw new Error("not currently signed in");
    }) as typeof execSync);

    expect(() => assertOpReady()).toThrow(/signed in/);
  });
});
