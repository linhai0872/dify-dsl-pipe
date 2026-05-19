import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DifyClient } from "./client.js";
import type { DifyApp, AppFilter, ExportResult, ExportedApp, PipeState } from "./types.js";
import type { StorageBackend } from "../storage/interface.js";
import type { ExportOptions } from "../config/types.js";
import { buildFilePath, sanitize } from "../utils/naming.js";
import { log, formatDuration, formatSize } from "../utils/logger.js";

export async function exportApps(
  client: DifyClient,
  storage: StorageBackend,
  opts: ExportOptions & {
    filter?: AppFilter;
    instanceName?: string;
    workspaceName?: string;
  }
): Promise<ExportResult> {
  const start = Date.now();
  const success: ExportedApp[] = [];
  const failed: { app: DifyApp; error: string }[] = [];

  // 加载增量状态
  let state: PipeState | null = null;
  if (opts.incremental) {
    state = await loadState(storage);
  }

  // 获取应用列表
  log.info("获取应用列表...");
  const filter = buildFilter(opts);
  const apps = await client.getAllApps(filter);
  log.success(`找到 ${apps.length} 个应用`);

  if (!apps.length) {
    return { success: [], failed: [], totalApps: 0, duration: Date.now() - start };
  }

  // 增量过滤
  let appsToExport = apps;
  if (state) {
    appsToExport = apps.filter((app) => {
      const prev = state!.apps[app.id];
      const updatedAt = typeof app.updated_at === "number"
        ? new Date(app.updated_at * 1000).toISOString()
        : String(app.updated_at);
      return !prev || prev.updatedAt < updatedAt;
    });
    if (appsToExport.length < apps.length) {
      log.info(`增量模式：${apps.length} 个应用中 ${appsToExport.length} 个有更新`);
    }
  }

  // 逐个导出
  for (let i = 0; i < appsToExport.length; i++) {
    const app = appsToExport[i];
    log.progress(i + 1, appsToExport.length, `${app.name} (${app.mode})`);

    try {
      const exported = await exportSingleApp(client, storage, app, opts);
      success.push(exported);

      if (state) {
        const updatedAt = typeof app.updated_at === "number"
          ? new Date(app.updated_at * 1000).toISOString()
          : String(app.updated_at);
        state.apps[app.id] = { updatedAt, exportedAt: new Date().toISOString() };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ app, error: msg.slice(0, 200) });
      log.warn(`跳过 ${app.name}: ${msg.slice(0, 100)}`);
    }
  }

  // 保存增量状态
  if (state) {
    state.lastExportAt = new Date().toISOString();
    await saveState(storage, state);
  }

  // finalize 存储（git commit 等）
  if (storage.finalize) {
    await storage.finalize();
  }

  const duration = Date.now() - start;
  return { success, failed, totalApps: apps.length, duration };
}

async function exportSingleApp(
  client: DifyClient,
  storage: StorageBackend,
  app: DifyApp,
  opts: ExportOptions & { instanceName?: string; workspaceName?: string }
): Promise<ExportedApp> {
  const tags = (app.tags ?? []).map((t) => t.name);
  const ctx = {
    app,
    tags,
    instance: opts.instanceName,
    workspace: opts.workspaceName,
  };

  // 导出当前版本
  const dslContent = await client.exportAppDSL(app.id, opts.includeSecret);
  const filePath = buildFilePath(opts.pattern, { ...ctx, version: "current" });
  await storage.write(filePath, dslContent);

  const exported: ExportedApp = { app, dslContent, filePath };

  // 导出版本历史
  if (opts.includeVersionHistory && ["workflow", "advanced-chat"].includes(app.mode)) {
    exported.versions = [];
    try {
      const versions = await client.getWorkflowVersions(app.id);
      for (const ver of versions) {
        if ((ver.marked_name ?? ver.version ?? "").toLowerCase() === "draft") continue;

        try {
          const verDsl = await client.exportAppDSL(app.id, opts.includeSecret, ver.id);
          const rawDate = ver.created_at;
          const verDate = rawDate
            ? new Date(typeof rawDate === "number" ? rawDate * 1000 : rawDate)
                .toISOString().slice(0, 16).replace(/[-T:]/g, "")
            : undefined;
          // 有名字用版本名，未命名用 app 名+时间戳
          const versionLabel = ver.marked_name ?? sanitize(app.name);
          const versionPattern = opts.pattern.replace(".yml", `_versions/${versionLabel}_{date}.yml`);
          const verPath = buildFilePath(versionPattern, {
            ...ctx,
            date: verDate,
          });
          await storage.write(verPath, verDsl);
          exported.versions.push({ version: ver, dslContent: verDsl, filePath: verPath });
        } catch {
          log.debug(`  跳过版本 ${ver.marked_name ?? ver.id.slice(0, 8)}: 导出失败`);
        }
      }
    } catch {
      log.debug(`  ${app.name}: 无法获取版本历史`);
    }
  }

  return exported;
}

function buildFilter(opts: ExportOptions): AppFilter | undefined {
  const filter = opts.filter;
  if (!filter) return undefined;

  const result: AppFilter = {};
  if (filter.names?.length) result.names = filter.names;
  if (filter.tags?.length) result.tags = filter.tags;
  if (filter.types?.length) result.types = filter.types as AppFilter["types"];
  return Object.keys(result).length ? result : undefined;
}

async function loadState(storage: StorageBackend): Promise<PipeState> {
  try {
    if (await storage.exists(".dify-pipe-state.json")) {
      const content = await storage.read(".dify-pipe-state.json");
      return JSON.parse(content);
    }
  } catch {
    // ignore
  }
  return { lastExportAt: "", apps: {} };
}

async function saveState(storage: StorageBackend, state: PipeState): Promise<void> {
  await storage.write(".dify-pipe-state.json", JSON.stringify(state, null, 2));
}
