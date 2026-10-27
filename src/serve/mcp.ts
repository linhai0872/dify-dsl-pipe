import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DifyClient } from "../core/client.js";
import { exportApps } from "../core/exporter.js";
import { importApps } from "../core/importer.js";
import { runMigrate } from "../core/migrate.js";
import { runDiff } from "../core/diff.js";
import { buildReport } from "../core/report.js";
import { PipeError } from "../core/errors.js";
import { parseFilterExpr } from "../core/source.js";
import type { StorageBackend } from "../storage/interface.js";
import type { Config, ExportOptions } from "../config/types.js";
import { VERSION } from "../version.js";

export interface McpContext {
  clients: Map<string, { client: DifyClient; name: string }>;
  storage: StorageBackend;
  exportOpts: ExportOptions;
  /** serve 启动时加载的配置；migrate/diff 的 profile 解析用。 */
  config: Config;
}

/** 统一 PipeError 信封；非 PipeError（HttpError、网络、fs 异常）归为 ERR_UNKNOWN，保证总有 code。 */
function errText(e: unknown): string {
  const pe = e instanceof PipeError
    ? e
    : new PipeError("ERR_UNKNOWN", e instanceof Error ? e.message : String(e));
  return JSON.stringify(pe.toJSON());
}

function text(payload: unknown, isError?: boolean) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function pickInstance(ctx: McpContext, instance?: string) {
  const entry = instance
    ? ctx.clients.get(instance)
    : ctx.clients.values().next().value;
  if (!entry) {
    throw new PipeError(
      "ERR_INSTANCE_NOT_FOUND",
      instance ? `Instance "${instance}" 未找到` : "无可用 Instance"
    );
  }
  return entry;
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: "dify-dsl-pipe",
    version: VERSION,
  });

  server.tool(
    "list_instances",
    "List connected Dify instances",
    {},
    async () => {
      try {
        const instances = Array.from(ctx.clients.entries()).map(([id, { client, name }]) => ({
          id,
          name,
          version: client.getInfo().version,
          adapter: client.getInfo().adapterType,
        }));
        return text(instances);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  server.tool(
    "list_apps",
    "List Dify applications from an instance",
    { instance: z.string().optional().describe("Instance ID (defaults to first)") },
    async ({ instance }) => {
      try {
        const entry = pickInstance(ctx, instance);
        const apps = await entry.client.getAllApps();
        const summary = apps.map((a) => ({
          id: a.id,
          name: a.name,
          mode: a.mode,
          tags: (a.tags ?? []).map((t) => t.name),
        }));
        return text(summary);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  server.tool(
    "export_apps",
    "Export Dify application DSL files",
    {
      instance: z.string().optional().describe("Instance ID (defaults to first)"),
      filter: z.string().optional().describe("Filter expression (e.g. type:workflow,tag:核心)"),
      incremental: z.boolean().optional().describe("Only export updated apps"),
    },
    async ({ instance, filter, incremental }) => {
      try {
        const entry = pickInstance(ctx, instance);
        const parsedFilter = parseFilterExpr(filter);
        const result = await exportApps(entry.client, ctx.storage, {
          ...ctx.exportOpts,
          incremental: incremental ?? false,
          filter: parsedFilter,
          instanceName: entry.name,
        });

        const issues = [
          ...result.success.flatMap((s) => s.issues ?? []),
          ...result.failed.map((f) => ({
            severity: "warning" as const,
            code: "UNKNOWN" as const,
            app: f.app.name,
            problem: `导出失败：${f.error}`,
            suggestion: "检查该应用是否可导出后重试",
          })),
        ];

        const report = buildReport("export", issues, result.failed.length === 0, {
          exported: result.success.length,
          failed: result.failed.length,
        });
        return text(report);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  server.tool(
    "import_apps",
    "Import DSL files into a Dify instance",
    {
      instance: z.string().optional().describe("Instance ID (defaults to first)"),
      onConflict: z.enum(["skip", "overwrite"]).optional().describe("Conflict strategy"),
      dryRun: z.boolean().optional().describe("Preview without importing"),
      fix: z.boolean().optional().describe("Auto-fix blocking preflight issues (drop local file defaults, regen non-UUID variable ids)"),
      publish: z.boolean().optional().describe("Publish workflow / advanced-chat apps after import"),
    },
    async ({ instance, onConflict, dryRun, fix, publish }) => {
      try {
        const entry = pickInstance(ctx, instance);
        const result = await importApps(entry.client, ctx.storage, {
          onConflict: onConflict ?? "skip",
          dryRun: dryRun ?? false,
          fix: fix ?? false,
          publish: publish ?? false,
          targetDifyVersion: entry.client.getInfo().version,
        });

        const blocking = result.issues.filter((i) => i.severity === "blocking").length;
        const report = buildReport(
          "import",
          result.issues,
          result.failed.length === 0 && blocking === 0 && result.publishFailed.length === 0,
          {
            created: result.created.length,
            skipped: result.skipped.length,
            overwritten: result.overwritten.length,
            failed: result.failed.length,
            published: result.published.length,
            publishFailed: result.publishFailed.length,
          }
        );
        return text(report);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  server.tool(
    "migrate_apps",
    "Migrate Dify apps between instances (export -> sanitize -> preview -> import)",
    {
      to: z.string().describe("Target profile name"),
      from: z.string().optional().describe("Source profile name (choose from or source)"),
      source: z.string().optional().describe("Local DSL directory (skips export)"),
      yes: z.boolean().optional().describe("Run the real import (default: preview only, no import requests)"),
      fix: z.boolean().optional().describe("Auto-fix blocking preflight issues"),
      publish: z.boolean().optional().describe("Publish workflow / advanced-chat apps after import"),
      onConflict: z.enum(["skip", "overwrite"]).optional().describe("Conflict strategy"),
    },
    async ({ to, from, source, yes, fix, publish, onConflict }) => {
      try {
        const report = await runMigrate({
          config: ctx.config,
          to,
          from,
          source,
          yes: yes ?? false,
          fix: fix ?? false,
          publish: publish ?? false,
          onConflict,
        });
        return text(report);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  server.tool(
    "diff_apps",
    "Diff DSL backups against an online Dify instance (read-only)",
    {
      profile: z.string().describe("Profile name to compare online side"),
      source: z.string().describe("Backup source directory or prefix"),
      check: z.boolean().optional().describe("Return isError when drift is found (CI use)"),
    },
    async ({ profile, source, check }) => {
      try {
        const report = await runDiff({
          config: ctx.config,
          profile,
          source,
          check: check ?? false,
        });
        return text(report, (check ?? false) && !report.success);
      } catch (e) {
        return text(JSON.parse(errText(e)), true);
      }
    }
  );

  return server;
}

export async function startMcpServer(ctx: McpContext) {
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
