import type { Command } from "commander";
import { runMigrate } from "../core/migrate.js";
import { loadConfig } from "../config/loader.js";
import { PipeError } from "../core/errors.js";
import { noticeItems } from "../core/report.js";
import { log, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerMigrateCommand(program: Command) {
  program
    .command("migrate")
    .description("跨实例迁移 Dify 应用（导出 → 清洗 → 预演 → 导入）")
    .option("--to <profile>", "目标 profile（必填）")
    .option("--from <profile>", "源 profile（与 --source 二选一）")
    .option("--source <localDir>", "本地 DSL 目录（跳过导出）")
    .option("--yes", "实际执行导入（默认只做预演，不发任何导入请求）")
    .option("--ephemeral", "使用系统临时目录作为工作目录（成功后删除）")
    .option("--on-conflict <strategy>", "冲突策略: skip, overwrite", "skip")
    .option("--fix", "自动修复预检 blocking 问题")
    .option("--publish", "导入后发布 workflow / advanced-chat 应用（默认只导入为草稿）")
    .option("--filter <expr>", "过滤表达式 (如 type:workflow,tag:核心,name:xxx)")
    .option("-c, --config <path>", "配置文件路径")
    .option("--json", "JSON 格式输出")
    .option("--verbose", "详细日志")
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel("debug");

      try {
        const config = loadConfig(opts.config);

        const report = await runMigrate({
          config,
          from: opts.from,
          to: opts.to,
          source: opts.source,
          yes: !!opts.yes,
          ephemeral: !!opts.ephemeral,
          onConflict: opts.onConflict,
          fix: !!opts.fix,
          publish: !!opts.publish,
          filter: opts.filter,
        });

        if (opts.json) {
          console.log(JSON.stringify(report));
        } else {
          console.error("");
          const prefix = opts.yes ? "" : pc.yellow("[预览] ");
          const s = report.stats ?? {};
          log.success(
            `${prefix}迁移完成：` +
            `${s.exported ?? 0} 导出, ` +
            `${pc.green(String(s.created ?? 0))} 创建, ` +
            `${pc.yellow(String(s.skipped ?? 0))} 跳过, ` +
            `${pc.blue(String(s.overwritten ?? 0))} 覆盖, ` +
            `${pc.red(String((s.failed ?? 0) + (s.exportFailed ?? 0)))} 失败`
          );

          if ((s.published ?? 0) > 0) {
            log.info(`${pc.green(String(s.published))} 个应用已发布`);
          }
          if ((s.publishFailed ?? 0) > 0) {
            log.warn(`${s.publishFailed} 个应用发布失败（仍保留已导入草稿）`);
          }
          if (report.summary.blocking) {
            log.warn(`${report.summary.blocking} 项阻断问题（加 --fix 自动修复或手动处理）`);
          }
          if (report.summary.warnings) {
            log.info(`${report.summary.warnings} 项 warning（插件/版本，建议确认）`);
          }
          for (const item of noticeItems(report.items)) {
            const line = `[${item.code}] ${item.app ?? "-"}：${item.problem}（${item.suggestion}）`;
            if (item.severity === "info") log.info(line);
            else log.warn(line);
          }
          if (report.meta?.workdir) {
            log.info(`工作目录：${report.meta.workdir}`);
          }

          if (!opts.yes) {
            console.error(pc.dim("  预览完成，加 --yes 执行导入"));
          }
        }

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
