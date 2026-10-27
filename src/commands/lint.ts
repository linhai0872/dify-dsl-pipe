import type { Command } from "commander";
import { runLint } from "../core/lint.js";
import { resolveImportPrefix, DEFAULT_SOURCE } from "../core/importer.js";
import { resolveSourceStorage } from "../core/source.js";
import { PipeError } from "../core/errors.js";
import { createStorage } from "../storage/factory.js";
import { loadConfig } from "../config/loader.js";
import { log, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerLintCommand(program: Command) {
  program
    .command("lint")
    .description("离线检查 DSL 备份目录，发现会导致迁移失败的问题")
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
    .option("-c, --config <path>", "配置文件路径")
    .option("--target-dify-version <ver>", "目标 Dify 版本，用于 DSL schema 兼容 warning")
    .option("--strict", "warning 也视为失败（退出码 1）")
    .option("--json", "JSON 格式输出")
    .option("--verbose", "详细日志")
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel("debug");

      try {
        const config = loadConfig(opts.config);

        // 源存储解析规则与 import 完全一致（共用 helper，D6 单点）
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
          config
        );

        const sourceStorage = createStorage(sourceStorageConfig);
        if (!(await sourceStorage.testConnection())) {
          throw new PipeError("ERR_STORAGE_CONNECT_FAILED", "源存储连接失败");
        }

        const targetDifyVersion =
          opts.targetDifyVersion ?? config.defaults?.import?.targetDifyVersion;

        const report = await runLint(sourceStorage, {
          prefix: resolveImportPrefix({
            storageType: sourceStorageConfig.type,
            source: opts.source,
            fromConfig,
          }),
          targetDifyVersion,
          strict: !!opts.strict,
        });

        if (opts.json) {
          console.log(JSON.stringify(report));
        } else if (report.stats?.files) {
          // 按 app 分组输出每条 issue，最后汇总一行
          const byApp = new Map<string, typeof report.items>();
          for (const issue of report.items) {
            const key = issue.app ?? "(未知应用)";
            (byApp.get(key) ?? byApp.set(key, []).get(key)!).push(issue);
          }
          for (const [app, list] of byApp) {
            log.info(app);
            for (const i of list) {
              const marker =
                i.severity === "blocking"
                  ? pc.red("✗")
                  : i.severity === "warning"
                    ? pc.yellow("⚠")
                    : pc.dim("ℹ");
              log.info(`  ${marker} [${i.code}] ${i.problem}`);
              if (i.suggestion) log.info(`    ${pc.dim(`建议：${i.suggestion}`)}`);
            }
          }
          const { files, blocking, warnings } = report.stats;
          const line = `检查 ${files} 个文件：${pc.red(String(blocking))} blocking, ${pc.yellow(String(warnings))} warning`;
          if (report.success) log.success(line);
          else log.error(line);
        }
        // 空目录时 runLint 已 log.warn("未找到任何 DSL 文件")

        process.exit(report.success ? 0 : 1);
      } catch (e) {
        if (opts.json) {
          const pe =
            e instanceof PipeError
              ? e.toJSON()
              : { success: false, error: e instanceof Error ? e.message : String(e) };
          console.log(JSON.stringify(pe));
        } else {
          log.error(e instanceof Error ? e.message : String(e));
        }
        process.exit(1);
      }
    });
}
