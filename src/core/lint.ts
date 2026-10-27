import { parse as parseYaml } from "yaml";
import type { StorageBackend } from "../storage/interface.js";
import type { PipeReport, RuleIssue } from "./report.js";
import { buildReport } from "./report.js";
import { preflightImportDSL } from "./dsl-rules.js";
import { listDslFiles } from "./source.js";
import { log } from "../utils/logger.js";

export interface LintOptions {
  /** list 前缀（s3/git 或 storage 来自 config 时的子路径）。 */
  prefix?: string;
  /** 目标 Dify 版本，用于 DSL schema 兼容 warning。 */
  targetDifyVersion?: string;
  /** strict 时 warning 也使 success=false（退出码 1）。 */
  strict?: boolean;
}

/**
 * 离线 lint：对备份目录跑与 import 预检完全相同的规则（D6 单点），
 * 不连 Dify、不报 NAME_CONFLICT、不做 fix。
 * success = 无 blocking 且（非 strict 或无 warning）。空目录 → success 并提示。
 */
export async function runLint(
  storage: StorageBackend,
  opts: LintOptions = {}
): Promise<PipeReport> {
  const files = await listDslFiles(storage, opts.prefix ?? "");

  if (!files.length) {
    log.warn("未找到任何 DSL 文件");
    return buildReport("lint", [], true, { files: 0, blocking: 0, warnings: 0 });
  }

  const issues: RuleIssue[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await storage.read(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      issues.push({
        severity: "blocking",
        code: "UNKNOWN",
        file,
        problem: `读取文件失败：${msg.slice(0, 150)}`,
        suggestion: "检查存储后端权限或文件是否损坏",
      });
      continue;
    }

    const name = extractAppName(content) ?? fileToAppName(file);
    const pre = preflightImportDSL(content, {
      app: name,
      file,
      fix: false,
      targetDifyVersion: opts.targetDifyVersion,
    });
    issues.push(...pre.issues);
  }

  const blocking = issues.filter((i) => i.severity === "blocking").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const success = blocking === 0 && (!opts.strict || warnings === 0);

  return buildReport("lint", issues, success, {
    files: files.length,
    blocking,
    warnings,
  });
}

function extractAppName(dslContent: string): string | null {
  try {
    const parsed = parseYaml(dslContent);
    const name = (parsed as Record<string, unknown> | undefined)?.app as
      | Record<string, unknown>
      | undefined;
    return typeof name?.name === "string" ? name.name : null;
  } catch {
    return null;
  }
}

function fileToAppName(filePath: string): string {
  const filename = filePath.split("/").pop() ?? filePath;
  return filename.replace(/\.ya?ml$/, "").replace(/_\d{8}$/, "").replace(/_current$/, "");
}
