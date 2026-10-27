import { Hono } from "hono";
import { Cron } from "croner";
import type { DifyClient } from "../core/client.js";
import { exportApps } from "../core/exporter.js";
import { importApps } from "../core/importer.js";
import type { StorageBackend } from "../storage/interface.js";
import type { ExportOptions, ImportOptions } from "../config/types.js";
import { log } from "../utils/logger.js";
import { sendWebhook } from "./webhook.js";

export interface NotificationConfig {
  enabled: boolean;
  onFailure: boolean;
  onSuccess: boolean;
}

export interface ServeContext {
  clients: Map<string, { client: DifyClient; name: string }>;
  storage: StorageBackend;
  exportOpts: ExportOptions;
  importOpts: ImportOptions;
  notification?: NotificationConfig;
}

interface CronJob {
  id: string;
  cron: string;
  instance: string;
  action: "export" | "import";
  enabled: boolean;
  lastRun?: string;
  lastResult?: { success: number; failed: number };
  handle?: Cron;
}

const jobs = new Map<string, CronJob>();
let jobCounter = 0;

export function createApi(ctx: ServeContext) {
  const app = new Hono();

  app.get("/status", (c) => {
    const instances = Array.from(ctx.clients.entries()).map(([id, { client, name }]) => ({
      id,
      name,
      version: client.getInfo().version,
      adapterType: client.getInfo().adapterType,
    }));
    return c.json({
      status: "running",
      instances,
      jobs: jobs.size,
      uptime: process.uptime(),
    });
  });

  app.post("/export", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const instanceId = (body as Record<string, string>).instance;

    const entry = instanceId
      ? ctx.clients.get(instanceId)
      : ctx.clients.values().next().value;

    if (!entry) {
      return c.json({ error: "Instance not found" }, 404);
    }

    try {
      const result = await exportApps(entry.client, ctx.storage, {
        ...ctx.exportOpts,
        instanceName: entry.name,
      });
      return c.json({
        success: true,
        exported: result.success.length,
        failed: result.failed.length,
        total: result.totalApps,
        duration: result.duration,
        files: result.success.map((e) => e.filePath),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/import", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const instanceId = (body as Record<string, string>).instance;

    const entry = instanceId
      ? ctx.clients.get(instanceId)
      : ctx.clients.values().next().value;

    if (!entry) {
      return c.json({ error: "Instance not found" }, 404);
    }

    try {
      const result = await importApps(entry.client, ctx.storage, ctx.importOpts);
      return c.json({
        success: true,
        created: result.created.length,
        skipped: result.skipped.length,
        overwritten: result.overwritten.length,
        failed: result.failed.length,
        duration: result.duration,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/jobs", (c) => {
    const list = Array.from(jobs.values()).map(({ handle, ...rest }) => rest);
    return c.json(list);
  });

  app.post("/jobs", async (c) => {
    const body = (await c.req.json()) as {
      cron: string;
      instance?: string;
      action?: "export" | "import";
    };

    if (!body.cron) {
      return c.json({ error: "cron expression required" }, 400);
    }

    const id = `job_${++jobCounter}`;
    const instanceId = body.instance ?? ctx.clients.keys().next().value;
    const action = body.action ?? "export";

    if (!instanceId || !ctx.clients.has(instanceId)) {
      return c.json({ error: "Instance not found" }, 404);
    }

    const job: CronJob = { id, cron: body.cron, instance: instanceId, action, enabled: true };

    job.handle = new Cron(body.cron, async () => {
      const entry = ctx.clients.get(instanceId);
      if (!entry) return;

      log.info(`[cron] ${id}: ${action} on ${entry.name}`);
      try {
        if (action === "export") {
          const result = await exportApps(entry.client, ctx.storage, {
            ...ctx.exportOpts,
            instanceName: entry.name,
          });
          job.lastResult = { success: result.success.length, failed: result.failed.length };
          const hasFailed = result.failed.length > 0;
          if (shouldNotify(ctx, hasFailed)) {
            await notify(`导出完成: ${result.success.length} 成功, ${result.failed.length} 失败`);
          }
        } else {
          const result = await importApps(entry.client, ctx.storage, ctx.importOpts);
          job.lastResult = { success: result.created.length, failed: result.failed.length };
          const hasFailed = result.failed.length > 0;
          if (shouldNotify(ctx, hasFailed)) {
            await notify(`导入完成: ${result.created.length} 创建, ${result.failed.length} 失败`);
          }
        }
      } catch (e) {
        job.lastResult = { success: 0, failed: -1 };
        log.error(`[cron] ${id} failed: ${e instanceof Error ? e.message : e}`);
        if (shouldNotify(ctx, true)) {
          await notify(`任务失败: ${e instanceof Error ? e.message : e}`);
        }
      }
      job.lastRun = new Date().toISOString();
    });

    jobs.set(id, job);
    return c.json({ id, cron: body.cron, instance: instanceId, action }, 201);
  });

  app.delete("/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    job.handle?.stop();
    jobs.delete(job.id);
    return c.json({ deleted: true });
  });

  return app;
}

let webhookUrl: string | undefined;

export function setWebhookUrl(url: string | undefined) {
  webhookUrl = url;
}

function shouldNotify(ctx: ServeContext, hasFailed: boolean): boolean {
  const n = ctx.notification;
  if (!n || !n.enabled) return !!webhookUrl;
  if (hasFailed) return n.onFailure;
  return n.onSuccess;
}

async function notify(message: string) {
  if (!webhookUrl) return;
  await sendWebhook(webhookUrl, message);
}

export function stopAllJobs() {
  for (const job of jobs.values()) {
    job.handle?.stop();
  }
  jobs.clear();
}
