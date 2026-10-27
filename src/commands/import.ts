import type { Command } from "commander";
import { importApps, resolveImportPrefix, DEFAULT_SOURCE } from "../core/importer.js";
import { setupPipe } from "../core/runner.js";
import { resolveSourceStorage } from "../core/source.js";
import { PipeError } from "../core/errors.js";
import { buildReport } from "../core/dsl-rules.js";
import { noticeItems } from "../core/report.js";
import { createStorage } from "../storage/factory.js";
import { log, formatDuration, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerImportCommand(program: Command) {
  program
    .command("import")
    .description("导入 DSL 到 Dify 实例")
    .option("--url <url>", "目标 Dify Console API 地址")
    .option("--token <token>", "Access Token")
    .option("--email <email>", "登录邮箱")
    .option("--password <password>", "登录密码")
    .option("--profile <name>", "使用配置文件中的 profile")
    .option("-c, --config <path>", "配置文件路径")
    .option("-s, --source <path>", "DSL 源目录或前缀", DEFAULT_SOURCE)
    .option("--storage <type>", "源存储类型: local, s3, git", "local")
    .option("--s3-bucket <bucket>", "S3 Bucket")
    .option("--s3-endpoint <endpoint>", "S3 端点")
    .option("--s3-region <region>", "S3 区域", "us-east-1")
    .option("--s3-access-key <key>", "S3 Access Key ID")
    .option("--s3-secret-key <key>", "S3 Secret Access Key")
    .option("--s3-force-path-style", "S3 强制 path-style（MinIO 必需）")
    .option("--git-repo <path>", "Git 仓库路径或 URL")
    .option("--git-branch <branch>", "Git 分支", "main")
    .option("--on-conflict <strategy>", "冲突策略: skip, overwrite", "skip")
    .option("--dry-run", "预览模式（不实际导入）")
    .option("--fix", "自动修复预检 blocking 问题（删 local 文件 default、非法变量 id 换 UUID）")
    .option("--publish", "导入后发布 workflow / advanced-chat 应用（默认只导入为草稿）")
    .option("--target-dify-version <ver>", "目标 Dify 版本，用于 DSL schema 兼容 warning")
    .option("--workspace <id>", "指定 Workspace ID")
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
          workspace: opts.workspace,
          // import 不传 storage flags — setupPipe 用于连接目标 Instance
          // 源 storage 由 CLI flags 单独决定
        });

        // 源存储：来自 defaults.storage（全局默认），否则按 CLI flags 构建（H6）
        const { storage: sourceStorageConfig, fromConfig } = resolveSourceStorage(
          {
            storage: opts.storage,
            source: opts.source,
            s3Bucket: opts.s3Bucket,
            s3Endpoint: opts.s3Endpoint,
            s3Region: opts.s3Region,
            s3AccessKey: opts.s3AccessKey,
            s3SecretKey: opts.s3SecretKey,
            s3ForcePathStyle: opts.s3ForcePathStyle,
            gitRepo: opts.gitRepo,
            gitBranch: opts.gitBranch,
          },
          ctx.config
        );

        const sourceStorage = createStorage(sourceStorageConfig);
        if (!(await sourceStorage.testConnection())) {
          throw new PipeError("ERR_STORAGE_CONNECT_FAILED", "源存储连接失败");
        }

        const { client } = ctx.clients.values().next().value!;

        const result = await importApps(client, sourceStorage, {
          dryRun: opts.dryRun ?? ctx.importOpts.dryRun,
          onConflict: opts.onConflict !== "skip" ? opts.onConflict : ctx.importOpts.onConflict,
          fix: opts.fix ?? ctx.importOpts.fix ?? false,
          publish: opts.publish ?? ctx.importOpts.publish ?? false,
          targetDifyVersion: opts.targetDifyVersion ?? ctx.importOpts.targetDifyVersion ?? client.getInfo().version,
          source: resolveImportPrefix({
            storageType: sourceStorageConfig.type,
            source: opts.source,
            fromConfig,
          }),
        });

        const blocking = result.issues.filter((i) => i.severity === "blocking").length;
        const warnings = result.issues.filter((i) => i.severity === "warning").length;
        const success =
          result.failed.length === 0 && blocking === 0 && result.publishFailed.length === 0;

        if (opts.json) {
          console.log(
            JSON.stringify(
              buildReport("import", result.issues, success, {
                created: result.created.length,
                skipped: result.skipped.length,
                overwritten: result.overwritten.length,
                failed: result.failed.length,
                published: result.published.length,
                publishFailed: result.publishFailed.length,
              })
            )
          );
        } else {
          console.error("");
          const prefix = opts.dryRun ? pc.yellow("[预览] ") : "";
          log.success(
            `${prefix}导入完成：` +
            `${pc.green(String(result.created.length))} 创建, ` +
            `${pc.yellow(String(result.skipped.length))} 跳过, ` +
            `${pc.blue(String(result.overwritten.length))} 覆盖, ` +
            `${pc.red(String(result.failed.length))} 失败 — ` +
            `耗时 ${formatDuration(result.duration)}`
          );

          if (result.published.length) {
            log.info(`${pc.green(String(result.published.length))} 个应用已发布`);
          }
          if (result.publishFailed.length) {
            log.warn(`${result.publishFailed.length} 个应用发布失败（仍保留已导入草稿）`);
          }
          if (blocking) log.warn(`${blocking} 项阻断问题（加 --fix 自动修复或手动处理）`);
          if (warnings) log.info(`${warnings} 项 warning（插件/版本，建议确认）`);
          for (const item of noticeItems(result.issues)) {
            const line = `[${item.code}] ${item.app ?? "-"}：${item.problem}（${item.suggestion}）`;
            if (item.severity === "info") log.info(line);
            else log.warn(line);
          }

          if (opts.dryRun && result.created.length + result.overwritten.length > 0) {
            console.error(pc.dim("  去掉 --dry-run 执行实际导入"));
          }
        }

        process.exit(!success ? 1 : 0);
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
