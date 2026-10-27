import { Command } from "commander";
import { registerExportCommand } from "./commands/export.js";
import { registerImportCommand } from "./commands/import.js";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerLintCommand } from "./commands/lint.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerDiffCommand } from "./commands/diff.js";
import { listPresets } from "./utils/naming.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("dify-dsl-pipe")
  .description("Dify DSL 一站式管道工具 — 导出、导入、跨实例迁移")
  .version(VERSION);

registerExportCommand(program);
registerImportCommand(program);
registerInitCommand(program);
registerServeCommand(program);
registerLintCommand(program);
registerMigrateCommand(program);
registerDiffCommand(program);

program
  .command("presets")
  .description("列出可用的文件命名预设")
  .action(() => {
    console.log("\n可用的命名预设:\n");
    for (const p of listPresets()) {
      console.log(`  ${p.name.padEnd(15)} ${p.pattern}`);
    }
    console.log("\n使用 --pattern <预设名或自定义规则> 指定命名方式");
    console.log("变量: {name}, {type}, {tags}, {date}, {id}, {instance}, {workspace}, {version}\n");
  });

program.parse();
