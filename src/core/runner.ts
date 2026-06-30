import { DifyClient } from "./client.js";
import { PipeError } from "./errors.js";
import { loadConfig, resolveInstanceConfig } from "../config/loader.js";
import { createStorage } from "../storage/factory.js";
import { log } from "../utils/logger.js";
import type { StorageBackend } from "../storage/interface.js";
import type { Config, ExportOptions, ImportOptions, StorageConfig } from "../config/types.js";

export interface PipeOpts {
  url?: string;
  token?: string;
  email?: string;
  password?: string;
  profile?: string;
  configPath?: string;
  workspace?: string;
  storageType?: string;
  out?: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3ForcePathStyle?: boolean;
  gitRepo?: string;
  gitBranch?: string;
}

export interface PipeContext {
  clients: Map<string, { client: DifyClient; name: string }>;
  storage: StorageBackend;
  exportOpts: ExportOptions;
  importOpts: ImportOptions;
  config: Config;
}

export async function setupPipe(opts: PipeOpts): Promise<PipeContext> {
  const config = loadConfig(opts.configPath);
  const clients = new Map<string, { client: DifyClient; name: string }>();

  let resolvedStorage: StorageConfig | undefined;
  let profileExportOpts: Partial<ExportOptions> = {};
  let profileImportOpts: Partial<ImportOptions> = {};

  if (opts.url) {
    const client = new DifyClient({
      baseUrl: opts.url,
      email: opts.email,
      password: opts.password,
      token: opts.token,
      timeout: 30,
      maxRetries: 3,
    });
    const info = await client.connect();
    clients.set("cli", { client, name: "cli" });
    log.success(`已连接 Dify ${info.version} (${info.adapterType} adapter)`);

    if (opts.workspace) {
      await client.switchWorkspace(opts.workspace);
      log.info(`已切换到 Workspace: ${opts.workspace}`);
    }

    resolvedStorage = config.defaults?.storage;
    profileExportOpts = config.defaults?.export ?? {};
    profileImportOpts = config.defaults?.import ?? {};
  } else if (opts.profile) {
    const resolved = resolveInstanceConfig(config, opts);
    const client = new DifyClient({
      baseUrl: resolved.instance.url,
      email: resolved.instance.email,
      password: resolved.instance.password,
      token: resolved.instance.token,
      timeout: resolved.instance.timeout,
      maxRetries: resolved.instance.maxRetries,
    });
    const info = await client.connect();
    clients.set(resolved.instance.name, { client, name: resolved.instance.name });
    log.success(`已连接 Dify ${info.version} (${info.adapterType} adapter)`);

    const ws = opts.workspace ?? resolved.workspace;
    if (ws) {
      await client.switchWorkspace(ws);
      log.info(`已切换到 Workspace: ${ws}`);
    }

    resolvedStorage = resolved.storage;
    profileExportOpts = resolved.exportOpts ?? {};
    profileImportOpts = resolved.importOpts ?? {};
  } else {
    for (const inst of config.instances) {
      try {
        const client = new DifyClient({
          baseUrl: inst.url,
          email: inst.email,
          password: inst.password,
          token: inst.token,
          timeout: inst.timeout ?? 30,
          maxRetries: inst.maxRetries ?? 3,
        });
        const info = await client.connect();
        clients.set(inst.name, { client, name: inst.name });
        log.success(`已连接 ${inst.name}: Dify ${info.version} (${info.adapterType})`);
      } catch (e) {
        log.warn(`跳过 ${inst.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    resolvedStorage = config.defaults?.storage;
    profileExportOpts = config.defaults?.export ?? {};
    profileImportOpts = config.defaults?.import ?? {};
  }

  if (clients.size === 0) {
    throw new PipeError("ERR_NO_INSTANCE", "未找到可用的 Dify 实例连接。使用 --url 指定地址，或创建配置文件。");
  }

  const finalStorageConfig = resolvedStorage ?? storageFromFlags(opts);
  const storage = createStorage(finalStorageConfig);
  if (!(await storage.testConnection())) {
    throw new PipeError("ERR_STORAGE_CONNECT_FAILED", "存储后端连接失败");
  }

  return {
    clients,
    storage,
    exportOpts: {
      includeSecret: false,
      includeVersionHistory: true,
      incremental: false,
      archive: "none",
      pattern: "by-type",
      sanitize: true,
      preserveLocalFiles: false,
      keepOriginal: false,
      ...profileExportOpts,
    },
    importOpts: {
      dryRun: false,
      onConflict: "skip",
      fix: false,
      ...profileImportOpts,
    },
    config,
  };
}

export function getClient(ctx: PipeContext, instanceId?: string): { client: DifyClient; name: string } {
  if (instanceId) {
    const entry = ctx.clients.get(instanceId);
    if (!entry) throw new PipeError("ERR_INSTANCE_NOT_FOUND", `Instance "${instanceId}" 未找到`);
    return entry;
  }
  const first = ctx.clients.values().next().value;
  if (!first) throw new PipeError("ERR_NO_INSTANCE", "无可用 Instance");
  return first;
}

export function storageFromFlags(opts: PipeOpts): StorageConfig {
  const type = opts.storageType ?? "local";

  if (type === "s3") {
    return {
      type: "s3",
      bucket: opts.s3Bucket ?? "",
      endpoint: opts.s3Endpoint,
      region: opts.s3Region ?? "us-east-1",
      accessKeyId: opts.s3AccessKey ?? process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: opts.s3SecretKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
      prefix: "",
      forcePathStyle: !!opts.s3ForcePathStyle,
    };
  }

  if (type === "git") {
    return {
      type: "git",
      repo: opts.gitRepo ?? ".",
      branch: opts.gitBranch ?? "main",
      path: ".",
      commitMessage: "chore: dify dsl backup {date}",
      authorName: "dify-dsl-pipe",
      authorEmail: "dify-dsl-pipe@noreply",
      push: true,
    };
  }

  return {
    type: "local",
    path: opts.out ?? "./dify-backup",
  };
}
