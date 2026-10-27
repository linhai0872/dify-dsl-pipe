import { describe, it, expect } from "vitest";
import { buildReport } from "../src/core/report.js";
import type { RuleIssue } from "../src/core/report.js";

// PipeReport 信封 v2（spec §5.1）：stats/meta 可选，summary 仍按 items 计数。

describe("PipeReport 信封", () => {
  it("stats/meta 传入时序列化包含，summary 按 items 计数", () => {
    const items: RuleIssue[] = [
      { severity: "blocking", code: "LOCAL_FILE_DEFAULT", problem: "p", suggestion: "s" },
      { severity: "warning", code: "AGENT_ASSETS_OMITTED", problem: "p", suggestion: "s" },
      { severity: "info", code: "NOT_PUBLISHED", problem: "p", suggestion: "s" },
    ];
    const report = buildReport(
      "migrate",
      items,
      false,
      { exported: 2, created: 1, failed: 0 },
      { workdir: ".dify-pipe-migrate/20261027-120000" }
    );
    const json = JSON.parse(JSON.stringify(report));
    expect(json.stats).toEqual({ exported: 2, created: 1, failed: 0 });
    expect(json.meta).toEqual({ workdir: ".dify-pipe-migrate/20261027-120000" });
    expect(json.summary).toEqual({ total: 3, blocking: 1, warnings: 1 });
    expect(json.success).toBe(false);
  });

  it("不传 stats/meta → JSON 不含这两个键", () => {
    const json = JSON.parse(JSON.stringify(buildReport("lint", [])));
    expect("stats" in json).toBe(false);
    expect("meta" in json).toBe(false);
  });
});
