import type { Command } from "commander";
import { exportApps } from "../core/exporter.js";
import { setupPipe, type PipeContext } from "../core/runner.js";
import { PipeError } from "../core/errors.js";
import { log, formatDuration, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerExportCommand(program: Command) {
  program
    .command("export")
    .description("导出 Dify 应用 DSL")
    .option("--url <url>", "Dify Console API 地址")
    .option("--token <token>", "Access Token")
    .option("--email <email>", "登录邮箱")
    .option("--password <password>", "登录密码")
    .option("--profile <name>", "使用配置文件中的 profile")
    .option("-c, --config <path>", "配置文件路径")
    .option("-o, --out <path>", "输出目录（本地存储时）", "./dify-backup")
    .option("--storage <type>", "存储类型: local, s3, git", "local")
    .option("--s3-bucket <bucket>", "S3 Bucket 名称")
    .option("--s3-endpoint <endpoint>", "S3 端点（兼容阿里云/腾讯云/MinIO 等）")
    .option("--s3-region <region>", "S3 区域", "us-east-1")
    .option("--s3-access-key <key>", "S3 Access Key ID")
    .option("--s3-secret-key <key>", "S3 Secret Access Key")
    .option("--s3-force-path-style", "S3 强制 path-style（MinIO 必需）")
    .option("--git-repo <path>", "Git 仓库路径或 URL")
    .option("--git-branch <branch>", "Git 分支", "main")
    .option("--pattern <pattern>", "命名规则", "by-type")
    .option("--filter <expr>", "过滤表达式 (如 type:workflow,tag:核心,name:xxx)")
    .option("--include-secret", "包含敏感信息")
    .option("--no-include-secret", "不包含敏感信息（默认）")
    .option("--include-versions", "包含版本历史（默认）")
    .option("--no-include-versions", "不包含版本历史")
    .option("--incremental", "增量导出（只导出有更新的应用）")
    .option("--zip", "打包为 ZIP 文件")
    .option("--workspace <id>", "指定 Workspace ID")
    .option("--all-workspaces", "导出所有 Workspace（自动遍历）")
    .option("--json", "JSON 格式输出")
    .option("--verbose", "详细日志")
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel("debug");

      try {
        const ctx = await setupPipe({
          url: opts.url,
          token: opts.token,
          email: opts.email,
          password: opts.password,
          profile: opts.profile,
          configPath: opts.config,
          workspace: opts.allWorkspaces ? undefined : opts.workspace,
          storageType: opts.storage,
          out: opts.out,
          s3Bucket: opts.s3Bucket,
          s3Endpoint: opts.s3Endpoint,
          s3Region: opts.s3Region,
          s3AccessKey: opts.s3AccessKey,
          s3SecretKey: opts.s3SecretKey,
          s3ForcePathStyle: opts.s3ForcePathStyle,
          gitRepo: opts.gitRepo,
          gitBranch: opts.gitBranch,
        });

        const filter = parseFilter(opts.filter);
        const baseExportOpts = {
          ...ctx.exportOpts,
          includeSecret: opts.includeSecret ?? ctx.exportOpts.includeSecret,
          includeVersionHistory: opts.includeVersions ?? ctx.exportOpts.includeVersionHistory,
          incremental: opts.incremental ?? ctx.exportOpts.incremental,
          archive: opts.zip ? "zip" as const : ctx.exportOpts.archive,
          filter: filter ?? ctx.exportOpts.filter,
          instanceName: ctx.clients.values().next().value?.name,
        };

        const { client } = ctx.clients.values().next().value!;
        let totalSuccess = 0;
        let totalFailed = 0;
        let totalDuration = 0;
        let hasError = false;

        if (opts.allWorkspaces) {
          const pattern = opts.pattern !== "by-type" ? opts.pattern : "by-workspace";
          const workspaces = await client.getWorkspaces();
          log.info(`找到 ${workspaces.length} 个 Workspace`);

          for (const ws of workspaces) {
            log.info(`\nWorkspace: ${pc.bold(ws.name)}`);
            try {
              await client.switchWorkspace(ws.id);
              const result = await exportApps(client, ctx.storage, {
                ...baseExportOpts,
                pattern,
                workspaceName: ws.name,
              });
              totalSuccess += result.success.length;
              totalFailed += result.failed.length;
              totalDuration += result.duration;
              if (result.failed.length) hasError = true;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log.warn(`跳过 Workspace ${ws.name}: ${msg.slice(0, 100)}`);
              hasError = true;
            }
          }
        } else {
          const result = await exportApps(client, ctx.storage, {
            ...baseExportOpts,
            pattern: opts.pattern !== "by-type" ? opts.pattern : ctx.exportOpts.pattern,
          });
          totalSuccess = result.success.length;
          totalFailed = result.failed.length;
          totalDuration = result.duration;
          hasError = result.failed.length > 0;
        }

        if (opts.json) {
          console.log(JSON.stringify({
            success: !hasError,
            exported: totalSuccess,
            failed: totalFailed,
            duration: totalDuration,
          }));
        } else {
          console.error("");
          log.success(
            `导出完成：${pc.bold(String(totalSuccess))} 个应用，` +
            `耗时 ${formatDuration(totalDuration)}`
          );
          if (totalFailed) log.warn(`${totalFailed} 个应用导出失败`);
        }

        process.exit(hasError ? 1 : 0);
      } catch (e) {
        if (opts.json) {
          const pe = e instanceof PipeError ? e.toJSON() : { success: false, error: e instanceof Error ? e.message : String(e) };
          console.log(JSON.stringify(pe));
        } else {
          log.error(e instanceof Error ? e.message : String(e));
        }
        process.exit(1);
      }
    });
}

function parseFilter(expr?: string) {
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
