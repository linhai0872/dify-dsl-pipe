import type { Command } from "commander";
import { runDiff } from "../core/diff.js";
import { PipeError } from "../core/errors.js";
import { loadConfig } from "../config/loader.js";
import { DEFAULT_SOURCE } from "../core/importer.js";
import { log, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerDiffCommand(program: Command) {
  program
    .command("diff")
    .description("对比 DSL 备份与线上 Dify 实例（或两份备份）的差异（只读，不修改任何内容）")
    .option("--profile <name>", "使用配置文件中的 profile（比线上）")
    .option("--baseline <dir>", "本地目录，作为基准与 --source 互比（不连 Dify）")
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
    .option("--filter <expr>", "过滤表达式（仅支持 name: / type:；tag: 不支持）")
    .option("--check", "存在漂移时以退出码 1 结束（CI 用）")
    .option("--show-chunks", "在 detail 中列出变化路径及两边取值（最多 20 条）")
    .option("--full", "整文档深比较（不做语义投影，含噪声）")
    .option("-c, --config <path>", "配置文件路径")
    .option("--json", "JSON 格式输出")
    .option("--verbose", "详细日志")
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel("debug");

      try {
        const config = loadConfig(opts.config);
        const report = await runDiff({
          config,
          profile: opts.profile,
          baseline: opts.baseline,
          source: opts.source,
          storage: {
            storage: opts.storage,
            s3Bucket: opts.s3Bucket,
            s3Endpoint: opts.s3Endpoint,
            s3Region: opts.s3Region,
            s3AccessKey: opts.s3AccessKey,
            s3SecretKey: opts.s3SecretKey,
            s3ForcePathStyle: opts.s3ForcePathStyle,
            gitRepo: opts.gitRepo,
            gitBranch: opts.gitBranch,
          },
          filter: opts.filter,
          check: opts.check,
          showChunks: opts.showChunks,
          full: opts.full,
        });

        if (opts.json) {
          console.log(JSON.stringify(report));
        } else {
          console.error("");
          const s = report.stats ?? { onlyInBackup: 0, onlyOnline: 0, changed: 0, same: 0 };
          log.success(
            `diff 完成：` +
            `${pc.blue(String(s.onlyOnline))} 仅线上, ` +
            `${pc.yellow(String(s.onlyInBackup))} 仅备份, ` +
            `${pc.red(String(s.changed))} 有差异, ` +
            `${pc.green(String(s.same))} 一致`
          );
          for (const item of report.items) {
            const loc = item.location ? ` (${item.location})` : "";
            const file = item.file ? ` [${item.file}]` : "";
            const line = `${item.app ?? "-"}${file}${loc} — ${item.problem}`;
            if (item.severity === "warning") log.warn(line);
            else if (item.severity === "blocking") log.error(line);
            else log.info(line);
          }
        }

        process.exit(report.success ? 0 : 1);
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
