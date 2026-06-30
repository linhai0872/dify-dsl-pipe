import { describe, it, expect } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  sanitizeExportDSL,
  preflightImportDSL,
  buildReport,
} from "../src/core/dsl-rules.js";

// 真实样本骨架（PO信息提取工作流，1.8.1 二开版）：
// 顶层 app/dependencies/kind/version/workflow；workflow.graph.nodes[].data.variables[]
// file 变量 default 形态按 Dify PR #37022 构造（样本本身为健康态、无 default）。

function dsl(vars: object[], extras: Record<string, unknown> = {}): string {
  const doc = {
    app: { name: "T", mode: "workflow" },
    kind: "app",
    version: "0.4.0",
    dependencies: [],
    workflow: {
      conversation_variables: [],
      environment_variables: [],
      graph: {
        nodes: [
          { id: "start", data: { type: "start", variables: vars } },
        ],
        edges: [],
      },
      ...extras,
    },
  };
  return stringifyYaml(doc);
}

const ctx = { app: "T", file: "T.yml" };

describe("sanitizeExportDSL", () => {
  it("删除 local_file 单 file 变量的 default", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "abc" } },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(true);
    const wf = parseYaml(r.dsl).workflow;
    expect(wf.graph.nodes[0].data.variables[0].default).toBeUndefined();
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].code).toBe("LOCAL_FILE_DEFAULT");
  });

  it("保留 remote_url default（无残留 id 键）", () => {
    const d = dsl([
      {
        variable: "f",
        type: "file",
        default: { transfer_method: "remote_url", url: "https://x/y.pdf" },
      },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(false);
    const def = parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default;
    expect(def.transfer_method).toBe("remote_url");
    expect(def.url).toBe("https://x/y.pdf");
  });

  it("remote_url default 残留 id 键 → 判 tenant-local 删整个（对齐 PR #37022）", () => {
    const d = dsl([
      {
        variable: "f",
        type: "file",
        default: { transfer_method: "remote_url", url: "https://x/y.pdf", upload_file_id: "stale" },
      },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(true);
    expect(parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default).toBeUndefined();
  });

  it("file-list 混合：删 local 项、留 remote 项", () => {
    const d = dsl([
      {
        variable: "fs",
        type: "file-list",
        default: [
          { transfer_method: "local_file", upload_file_id: "a" },
          { transfer_method: "remote_url", url: "https://x/r.pdf" },
        ],
      },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(true);
    const def = parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default;
    expect(def).toHaveLength(1);
    expect(def[0].transfer_method).toBe("remote_url");
  });

  it("file-list 全 local → 删除整个 default", () => {
    const d = dsl([
      { variable: "fs", type: "file-list", default: [{ transfer_method: "local_file", upload_file_id: "a" }] },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default).toBeUndefined();
  });

  it("非 file 变量带 upload_file_id 不动（不误伤）", () => {
    const d = dsl([
      { variable: "n", type: "text-input", default: { upload_file_id: "x" } },
    ]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(false);
    expect(r.issues).toHaveLength(0);
  });

  it("preserveLocalFiles 跳过清洗", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "abc" } },
    ]);
    const r = sanitizeExportDSL(d, ctx, { preserveLocalFiles: true });
    expect(r.modified).toBe(false);
    expect(parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default.upload_file_id).toBe("abc");
  });

  it("空数组 file-list default 不误报不删除", () => {
    const d = dsl([{ variable: "fs", type: "file-list", default: [] }]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(false);
    expect(r.issues).toHaveLength(0);
    expect(parseYaml(r.dsl).workflow.graph.nodes[0].data.variables[0].default).toEqual([]);
  });

  it("无 file 变量 / 无 default 不改", () => {
    const d = dsl([{ variable: "n", type: "paragraph", default: "hi" }]);
    const r = sanitizeExportDSL(d, ctx);
    expect(r.modified).toBe(false);
    expect(r.issues).toHaveLength(0);
  });
});

describe("preflightImportDSL", () => {
  it("local file default → blocking", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "abc" } },
    ]);
    const r = preflightImportDSL(d, { app: "T" });
    expect(r.issues.some((i) => i.code === "LOCAL_FILE_DEFAULT" && i.severity === "blocking")).toBe(true);
    expect(r.fixedDsl).toBeUndefined();
  });

  it("--fix 删除 local file default", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "abc" } },
    ]);
    const r = preflightImportDSL(d, { app: "T", fix: true });
    expect(r.modified).toBe(true);
    expect(r.fixedDsl).toBeDefined();
    expect(parseYaml(r.fixedDsl!).workflow.graph.nodes[0].data.variables[0].default).toBeUndefined();
  });

  it("file-list 混合 default → blocking；--fix 删 local 项留 remote 项", () => {
    const d = dsl([
      {
        variable: "fs",
        type: "file-list",
        default: [
          { transfer_method: "local_file", upload_file_id: "a" },
          { transfer_method: "remote_url", url: "https://x/r.pdf" },
        ],
      },
    ]);
    const pre = preflightImportDSL(d, { app: "T" });
    expect(pre.issues.some((i) => i.code === "LOCAL_FILE_DEFAULT" && i.severity === "blocking")).toBe(true);

    const fixed = preflightImportDSL(d, { app: "T", fix: true });
    expect(fixed.modified).toBe(true);
    const def = parseYaml(fixed.fixedDsl!).workflow.graph.nodes[0].data.variables[0].default;
    expect(def).toHaveLength(1);
    expect(def[0].transfer_method).toBe("remote_url");
  });

  it("file-list 全 local → blocking；--fix 删整个 default", () => {
    const d = dsl([
      { variable: "fs", type: "file-list", default: [{ transfer_method: "local_file", upload_file_id: "a" }] },
    ]);
    const fixed = preflightImportDSL(d, { app: "T", fix: true });
    expect(fixed.modified).toBe(true);
    expect(parseYaml(fixed.fixedDsl!).workflow.graph.nodes[0].data.variables[0].default).toBeUndefined();
  });

  it("--fix 修复后 issue 降级为 info（summary.blocking 清零）", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "a" } },
    ]);
    const fixed = preflightImportDSL(d, { app: "T", fix: true });
    expect(fixed.issues.every((i) => i.severity === "info")).toBe(true);
    const report = buildReport("import", fixed.issues, true);
    expect(report.summary.blocking).toBe(0);
  });

  it("非 UUID conversation/env 变量 id → blocking", () => {
    const d = stringifyYaml({
      kind: "app",
      version: "0.4.0",
      workflow: {
        conversation_variables: [{ id: "opt-comp-prompt-var", name: "cv", value_type: "string" }],
        environment_variables: [{ id: "not-a-uuid", name: "ev" }],
        graph: { nodes: [{ id: "start", data: { type: "start", variables: [] } }], edges: [] },
      },
    });
    const r = preflightImportDSL(d, { app: "T" });
    const ids = r.issues.filter((i) => i.code === "INVALID_VARIABLE_ID");
    expect(ids).toHaveLength(2);
    expect(ids.every((i) => i.severity === "blocking")).toBe(true);
  });

  it("--fix 换合法 UUID", () => {
    const d = stringifyYaml({
      kind: "app",
      version: "0.4.0",
      workflow: {
        conversation_variables: [{ id: "bad", name: "cv" }],
        environment_variables: [],
        graph: { nodes: [{ id: "start", data: { type: "start", variables: [] } }], edges: [] },
      },
    });
    const r = preflightImportDSL(d, { app: "T", fix: true });
    expect(r.modified).toBe(true);
    const fixed = parseYaml(r.fixedDsl!).workflow.conversation_variables[0].id;
    expect(fixed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("合法 UUID 变量 id 不报", () => {
    const d = stringifyYaml({
      kind: "app",
      version: "0.4.0",
      workflow: {
        conversation_variables: [{ id: "c2959311-b12d-41ef-b32c-a68f5f6cca89", name: "cv" }],
        environment_variables: [],
        graph: { nodes: [{ id: "start", data: { type: "start", variables: [] } }], edges: [] },
      },
    });
    const r = preflightImportDSL(d, { app: "T" });
    expect(r.issues.some((i) => i.code === "INVALID_VARIABLE_ID")).toBe(false);
  });

  it("插件 dependencies → warning，不阻断", () => {
    const d = stringifyYaml({
      app: { name: "T", mode: "workflow" },
      kind: "app",
      version: "0.4.0",
      dependencies: [{ type: "marketplace", value: { marketplace_plugin_unique_identifier: "x:0.0.1" } }],
      workflow: { conversation_variables: [], environment_variables: [], graph: { nodes: [], edges: [] } },
    });
    const r = preflightImportDSL(d, { app: "T" });
    const dep = r.issues.find((i) => i.code === "PLUGIN_MISSING");
    expect(dep?.severity).toBe("warning");
    expect(r.issues.some((i) => i.severity === "blocking")).toBe(false);
  });

  it("DSL version 与目标 Dify major 不一致 → warning", () => {
    const d = dsl([], {});
    const r = preflightImportDSL(d, { app: "T", targetDifyVersion: "1.8.1" });
    // dsl() 默认 version 0.4.0 → major 0 vs 1 → warning
    expect(r.issues.some((i) => i.code === "DSL_VERSION_MISMATCH" && i.severity === "warning")).toBe(true);
  });

  it("无 targetDifyVersion 时不发 DSL_VERSION_MISMATCH", () => {
    const d = dsl([], {});
    const r = preflightImportDSL(d, { app: "T" });
    expect(r.issues.some((i) => i.code === "DSL_VERSION_MISMATCH")).toBe(false);
  });

  it("无 --fix 时 fixedDsl 不返回", () => {
    const d = dsl([
      { variable: "f", type: "file", default: { transfer_method: "local_file", upload_file_id: "a" } },
    ]);
    const r = preflightImportDSL(d, { app: "T" });
    expect(r.fixedDsl).toBeUndefined();
    expect(r.modified).toBe(false);
  });
});

describe("buildReport", () => {
  it("summary 按 severity 计数", () => {
    const report = buildReport(
      "import",
      [
        { severity: "blocking", code: "LOCAL_FILE_DEFAULT", problem: "p", suggestion: "s" },
        { severity: "warning", code: "PLUGIN_MISSING", problem: "p", suggestion: "s" },
        { severity: "info", code: "NAME_CONFLICT", problem: "p", suggestion: "s" },
      ]
    );
    expect(report.summary).toEqual({ total: 3, blocking: 1, warnings: 1 });
    expect(report.success).toBe(true);
  });
});
