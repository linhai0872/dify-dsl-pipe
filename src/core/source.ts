import type { StorageBackend } from "../storage/interface.js";
import type { Config, StorageConfig } from "../config/types.js";
import { storageFromFlags, type PipeOpts } from "./runner.js";

/**
 * 列出存储中的 DSL 文件：.yml/.yaml，跳过 _versions/、.orig、状态文件。
 * （H5：去掉 importer 里不可达的 .json 判断。）
 */
export async function listDslFiles(
  storage: StorageBackend,
  prefix = ""
): Promise<string[]> {
  const files = await storage.list(prefix);
  return files.filter(
    (f) =>
      (f.endsWith(".yml") || f.endsWith(".yaml")) &&
      !f.includes("_versions/") &&
      !f.endsWith(".orig") &&
      !f.endsWith(".dify-pipe-state.json")
  );
}

/**
 * 解析 import 源存储配置。
 * 注意：这里读的是 config.defaults.storage（全局默认），而不是 profile 的 storage（H6）。
 * 行为与 0.3.1 完全一致；未来如需改读 profile storage，须另做兼容方案。
 */
export function resolveSourceStorage(
  opts: {
    storage?: string;
    source?: string;
    s3Bucket?: string;
    s3Endpoint?: string;
    s3Region?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3ForcePathStyle?: boolean;
    gitRepo?: string;
    gitBranch?: string;
  },
  config: Config
): { storage: StorageConfig; fromConfig: boolean } {
  const profileStorage = config.defaults?.storage;
  if (profileStorage) return { storage: profileStorage, fromConfig: true };

  return {
    storage: storageFromFlags({
      storageType: opts.storage,
      out: opts.source,
      s3Bucket: opts.s3Bucket,
      s3Endpoint: opts.s3Endpoint,
      s3Region: opts.s3Region,
      s3AccessKey: opts.s3AccessKey,
      s3SecretKey: opts.s3SecretKey,
      s3ForcePathStyle: opts.s3ForcePathStyle,
      gitRepo: opts.gitRepo,
      gitBranch: opts.gitBranch,
    } as PipeOpts),
    fromConfig: false,
  };
}

/**
 * 解析 filter 表达式：type:/tag:/name:，逗号分隔；value 中允许出现 ':'。
 * 与 export.ts / serve/mcp.ts 的旧实现语义一致（H2 单点）。
 */
export function parseFilterExpr(expr?: string): {
  names?: string[];
  tags?: string[];
  types?: string[];
} | undefined {
  if (!expr) return undefined;

  const filter: { names?: string[]; tags?: string[]; types?: string[] } = {};

  for (const part of expr.split(",")) {
    const [key, ...valueParts] = part.split(":");
    const value = valueParts.join(":");
    if (!value) continue;

    switch (key.trim().toLowerCase()) {
      case "type":
        (filter.types ??= []).push(value.trim());
        break;
      case "tag":
        (filter.tags ??= []).push(value.trim());
        break;
      case "name":
        (filter.names ??= []).push(value.trim());
        break;
    }
  }

  return Object.keys(filter).length ? filter : undefined;
}
