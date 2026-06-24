import { describe, it, expect } from "vitest";
import {
  sanitize,
  resolvePattern,
  buildFilePath,
} from "../src/utils/naming.js";
import type { DifyApp, AppMode } from "../src/core/types.js";

function makeApp(overrides: Partial<DifyApp> = {}): DifyApp {
  return {
    id: "1234567890abcdef",
    name: "MyApp",
    mode: "workflow" as AppMode,
    description: "",
    icon: "",
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

describe("sanitize", () => {
  it("replaces filesystem-unsafe characters with underscore", () => {
    expect(sanitize('a/b:c*?"<>|d')).toBe("a_b_c______d");
  });

  it("falls back to 'unnamed' for empty input", () => {
    expect(sanitize("")).toBe("unnamed");
  });

  it("truncates names longer than 80 characters", () => {
    // Arrange
    const longName = "a".repeat(100);

    // Act
    const result = sanitize(longName);

    // Assert
    expect(result).toHaveLength(80);
    expect(result).toBe("a".repeat(80));
  });

  it("prefixes Windows reserved names with an underscore", () => {
    expect(sanitize("con")).toBe("_con");
    expect(sanitize("prn")).toBe("_prn");
    expect(sanitize("aux")).toBe("_aux");
    expect(sanitize("nul")).toBe("_nul");
    expect(sanitize("com1")).toBe("_com1");
    expect(sanitize("lpt1")).toBe("_lpt1");
  });

  it("treats Windows reserved names case-insensitively", () => {
    expect(sanitize("CON")).toBe("_CON");
    expect(sanitize("Com9")).toBe("_Com9");
    expect(sanitize("LPT3")).toBe("_LPT3");
  });

  it("returns ordinary names unchanged", () => {
    expect(sanitize("MyApp")).toBe("MyApp");
    expect(sanitize("hello world")).toBe("hello world");
    // 'console' is not a reserved name, only exact 'con' is
    expect(sanitize("console")).toBe("console");
  });
});

describe("resolvePattern", () => {
  it("maps preset names to their template strings", () => {
    expect(resolvePattern("flat")).toBe("{name}.yml");
    expect(resolvePattern("by-type")).toBe("{type}/{name}.yml");
    expect(resolvePattern("by-tag")).toBe("{tags}/{name}_{date}.yml");
    expect(resolvePattern("by-workspace")).toBe(
      "{workspace}/{type}/{name}_{date}.yml",
    );
    expect(resolvePattern("full")).toBe(
      "{instance}/{workspace}/{type}/{name}_{date}.yml",
    );
  });

  it("returns non-preset patterns unchanged (custom templates pass through)", () => {
    expect(resolvePattern("{name}-{type}.yml")).toBe("{name}-{type}.yml");
    expect(resolvePattern("custom/path.yml")).toBe("custom/path.yml");
  });
});

describe("buildFilePath", () => {
  const date = "20260624";

  describe("preset expansion", () => {
    it("expands the 'flat' preset", () => {
      const app = makeApp();
      expect(buildFilePath("flat", { app, date })).toBe("MyApp.yml");
    });

    it("expands the 'by-type' preset using the app mode", () => {
      const app = makeApp({ mode: "workflow" as AppMode });
      expect(buildFilePath("by-type", { app, date })).toBe(
        "workflow/MyApp.yml",
      );
    });

    it("expands the 'by-tag' preset", () => {
      const app = makeApp();
      expect(buildFilePath("by-tag", { app, tags: ["sales"], date })).toBe(
        "sales/MyApp_20260624.yml",
      );
    });

    it("expands the 'by-workspace' preset with default workspace", () => {
      const app = makeApp();
      expect(buildFilePath("by-workspace", { app, date })).toBe(
        "default/workflow/MyApp_20260624.yml",
      );
    });

    it("expands the 'full' preset with default instance and workspace", () => {
      const app = makeApp();
      expect(buildFilePath("full", { app, date })).toBe(
        "default/default/workflow/MyApp_20260624.yml",
      );
    });
  });

  describe("{tags} placeholder", () => {
    it("falls back to 'untagged' when no tags are given", () => {
      const app = makeApp();
      expect(buildFilePath("by-tag", { app, date })).toBe(
        "untagged/MyApp_20260624.yml",
      );
    });

    it("falls back to 'untagged' for an empty tags array", () => {
      const app = makeApp();
      expect(buildFilePath("by-tag", { app, tags: [], date })).toBe(
        "untagged/MyApp_20260624.yml",
      );
    });

    it("joins multiple tags with '-'", () => {
      const app = makeApp();
      expect(
        buildFilePath("by-tag", { app, tags: ["a", "b", "c"], date }),
      ).toBe("a-b-c/MyApp_20260624.yml");
    });
  });

  describe("{id} placeholder", () => {
    it("uses only the first 8 characters of the id", () => {
      const app = makeApp({ id: "1234567890abcdef" });
      expect(buildFilePath("{id}.yml", { app, date })).toBe("12345678.yml");
    });
  });

  describe("instance / workspace / version defaults", () => {
    it("uses default/default/current when not provided", () => {
      const app = makeApp();
      expect(
        buildFilePath("{instance}/{workspace}/{version}/{name}.yml", {
          app,
          date,
        }),
      ).toBe("default/default/current/MyApp.yml");
    });

    it("uses provided instance / workspace / version values", () => {
      const app = makeApp();
      expect(
        buildFilePath("{instance}/{workspace}/{version}/{name}.yml", {
          app,
          instance: "prod",
          workspace: "team",
          version: "v2",
          date,
        }),
      ).toBe("prod/team/v2/MyApp.yml");
    });
  });

  describe("custom templates", () => {
    it("substitutes placeholders in a non-preset template", () => {
      const app = makeApp();
      expect(buildFilePath("{name}-{type}.yml", { app, date })).toBe(
        "MyApp-workflow.yml",
      );
    });
  });

  describe("path cleanup", () => {
    it("collapses repeated slashes and strips a leading slash", () => {
      const app = makeApp();
      expect(buildFilePath("/{workspace}//{name}.yml", { app, date })).toBe(
        "default/MyApp.yml",
      );
    });
  });

  describe("name sanitization", () => {
    it("sanitizes unsafe characters in the app name", () => {
      const app = makeApp({ name: "a/b:c" });
      expect(buildFilePath("flat", { app, date })).toBe("a_b_c.yml");
    });
  });

  describe("repeated placeholder", () => {
    it("replaces every occurrence of a repeated placeholder", () => {
      const app = makeApp();
      expect(buildFilePath("{name}/{name}.yml", { app, date })).toBe(
        "MyApp/MyApp.yml",
      );
    });
  });
});
