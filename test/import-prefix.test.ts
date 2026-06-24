import { describe, it, expect } from "vitest";
import { resolveImportPrefix } from "../src/core/importer.js";

describe("resolveImportPrefix", () => {
  describe("storage built from --source flags (fromConfig=false)", () => {
    it("returns undefined for local + custom source (storage already rooted there)", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "local",
        source: "./dify-backup/_x",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBeUndefined();
    });

    it("returns undefined for local + default source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "local",
        source: "./dify-backup",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBeUndefined();
    });

    it("returns the source for s3 + custom source (object key prefix)", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "s3",
        source: "backups/prod",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBe("backups/prod");
    });

    it("returns undefined for s3 + default source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "s3",
        source: "./dify-backup",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBeUndefined();
    });

    it("returns the source for git + custom source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "git",
        source: "apps/v2",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBe("apps/v2");
    });

    it("returns undefined for git + default source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "git",
        source: "./dify-backup",
        fromConfig: false,
      });

      // Assert
      expect(prefix).toBeUndefined();
    });
  });

  describe("storage from config (fromConfig=true)", () => {
    it("returns the source for local + custom source (source is a sub-prefix of the configured root)", () => {
      // Arrange / Act — regression guard: config-rooted local must honor --source subdir
      const prefix = resolveImportPrefix({
        storageType: "local",
        source: "workflow",
        fromConfig: true,
      });

      // Assert
      expect(prefix).toBe("workflow");
    });

    it("returns undefined for local + default source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "local",
        source: "./dify-backup",
        fromConfig: true,
      });

      // Assert
      expect(prefix).toBeUndefined();
    });

    it("returns the source for s3 + custom source", () => {
      // Arrange / Act
      const prefix = resolveImportPrefix({
        storageType: "s3",
        source: "prod",
        fromConfig: true,
      });

      // Assert
      expect(prefix).toBe("prod");
    });
  });
});
