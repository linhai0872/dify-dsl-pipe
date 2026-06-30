import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DifyClient } from "../core/client.js";
import { exportApps } from "../core/exporter.js";
import { importApps } from "../core/importer.js";
import type { StorageBackend } from "../storage/interface.js";
import type { ExportOptions } from "../config/types.js";
import { VERSION } from "../version.js";

interface McpContext {
  clients: Map<string, { client: DifyClient; name: string }>;
  storage: StorageBackend;
  exportOpts: ExportOptions;
}

export async function startMcpServer(ctx: McpContext) {
  const server = new McpServer({
    name: "dify-dsl-pipe",
    version: VERSION,
  });

  server.tool(
    "list_instances",
    "List connected Dify instances",
    {},
    async () => {
      const instances = Array.from(ctx.clients.entries()).map(([id, { client, name }]) => ({
        id,
        name,
        version: client.getInfo().version,
        adapter: client.getInfo().adapterType,
      }));
      return { content: [{ type: "text", text: JSON.stringify(instances, null, 2) }] };
    }
  );

  server.tool(
    "list_apps",
    "List Dify applications from an instance",
    { instance: z.string().optional().describe("Instance ID (defaults to first)") },
    async ({ instance }) => {
      const entry = instance
        ? ctx.clients.get(instance)
        : ctx.clients.values().next().value;

      if (!entry) {
        return { content: [{ type: "text", text: "Error: Instance not found" }], isError: true };
      }

      const apps = await entry.client.getAllApps();
      const summary = apps.map((a) => ({
        id: a.id,
        name: a.name,
        mode: a.mode,
        tags: (a.tags ?? []).map((t) => t.name),
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
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
      const entry = instance
        ? ctx.clients.get(instance)
        : ctx.clients.values().next().value;

      if (!entry) {
        return { content: [{ type: "text", text: "Error: Instance not found" }], isError: true };
      }

      const parsedFilter = filter ? parseFilterExpr(filter) : undefined;
      const result = await exportApps(entry.client, ctx.storage, {
        ...ctx.exportOpts,
        incremental: incremental ?? false,
        filter: parsedFilter,
        instanceName: entry.name,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            exported: result.success.length,
            failed: result.failed.length,
            total: result.totalApps,
            duration: result.duration,
            files: result.success.map((e) => e.filePath),
          }, null, 2),
        }],
      };
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
    },
    async ({ instance, onConflict, dryRun, fix }) => {
      const entry = instance
        ? ctx.clients.get(instance)
        : ctx.clients.values().next().value;

      if (!entry) {
        return { content: [{ type: "text", text: "Error: Instance not found" }], isError: true };
      }

      const result = await importApps(entry.client, ctx.storage, {
        onConflict: onConflict ?? "skip",
        dryRun: dryRun ?? false,
        fix: fix ?? false,
        targetDifyVersion: entry.client.getInfo().version,
      });

      const blocking = result.issues.filter((i) => i.severity === "blocking").length;
      const warnings = result.issues.filter((i) => i.severity === "warning").length;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            dryRun: dryRun ?? false,
            created: result.created.length,
            skipped: result.skipped.length,
            overwritten: result.overwritten.length,
            failed: result.failed.length,
            blocking,
            warnings,
            issues: result.issues,
            duration: result.duration,
          }, null, 2),
        }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseFilterExpr(expr: string) {
  const filter: { names?: string[]; tags?: string[]; types?: string[] } = {};
  for (const part of expr.split(",")) {
    const [key, ...rest] = part.split(":");
    const value = rest.join(":");
    if (!value) continue;
    switch (key.trim().toLowerCase()) {
      case "type": (filter.types ??= []).push(value.trim()); break;
      case "tag": (filter.tags ??= []).push(value.trim()); break;
      case "name": (filter.names ??= []).push(value.trim()); break;
    }
  }
  return Object.keys(filter).length ? filter : undefined;
}
