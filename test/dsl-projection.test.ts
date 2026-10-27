import { describe, it, expect } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { projectDSL } from "../src/core/dsl-projection.js";

function baseDoc(extra: Record<string, unknown> = {}) {
  return {
    app: { name: "A", mode: "workflow", icon: "🤖", icon_type: "emoji" },
    kind: "app",
    version: "0.4.0",
    dependencies: [{ type: "plugin", value: "x@1" }],
    workflow: {
      graph: {
        viewport: { x: 1, y: 2, zoom: 1 },
        nodes: [
          {
            id: "n1",
            position: { x: 10, y: 20 },
            positionAbsolute: { x: 10, y: 20 },
            selected: false,
            width: 240,
            height: 80,
            dragging: false,
            zIndex: 0,
            sourcePosition: "right",
            targetPosition: "left",
            data: { type: "start", title: "开始", dataset_ids: ["ds-1", "ds-2"] },
          },
          {
            id: "n2",
            position: { x: 99, y: 99 },
            data: { type: "llm", title: "LLM" },
          },
        ],
        edges: [
          { id: "e1", source: "n1", target: "n2", selected: true, zIndex: 5 },
        ],
      },
      environment_variables: [
        { id: "env-id-1", name: "KEY", value: "v", value_type: "string" },
        { id: "env-id-2", name: "SECRET", value: "s3cret", value_type: "secret" },
      ],
      conversation_variables: [
        { id: "conv-id-1", name: "cv", value: "x" },
      ],
    },
    ...extra,
  };
}

describe("projectDSL", () => {
  it("不改输入对象（纯函数）", () => {
    const doc = baseDoc();
    const snapshot = JSON.stringify(doc);
    projectDSL(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("删除 version 与 dependencies", () => {
    const p = projectDSL(baseDoc()) as Record<string, unknown>;
    expect("version" in p).toBe(false);
    expect("dependencies" in p).toBe(false);
  });

  it("删除 workflow.graph.viewport", () => {
    const p = projectDSL(baseDoc()) as any;
    expect("viewport" in p.workflow.graph).toBe(false);
  });

  it("删除节点画布字段，保留 data", () => {
    const p = projectDSL(baseDoc()) as any;
    const n1 = p.workflow.graph.nodes.find((n: any) => n.id === "n1");
    for (const k of ["position", "positionAbsolute", "selected", "width", "height", "dragging", "zIndex", "sourcePosition", "targetPosition"]) {
      expect(k in n1).toBe(false);
    }
    expect(n1.data.title).toBe("开始");
  });

  it("删除边 selected/zIndex", () => {
    const p = projectDSL(baseDoc()) as any;
    const e1 = p.workflow.graph.edges[0];
    expect("selected" in e1).toBe(false);
    expect("zIndex" in e1).toBe(false);
    expect(e1.source).toBe("n1");
  });

  it("删除环境/会话变量 id；secret 类型 env 变量删 value", () => {
    const p = projectDSL(baseDoc()) as any;
    for (const v of p.workflow.environment_variables) expect("id" in v).toBe(false);
    for (const v of p.workflow.conversation_variables) expect("id" in v).toBe(false);
    const secret = p.workflow.environment_variables.find((v: any) => v.name === "SECRET");
    expect("value" in secret).toBe(false);
    const normal = p.workflow.environment_variables.find((v: any) => v.name === "KEY");
    expect(normal.value).toBe("v");
  });

  it("icon_type == image 时删 app.icon；emoji 时保留", () => {
    const imgDoc = baseDoc();
    (imgDoc.app as any).icon_type = "image";
    (imgDoc.app as any).icon = "https://x/icon.png";
    const p1 = projectDSL(imgDoc) as any;
    expect("icon" in p1.app).toBe(false);

    const p2 = projectDSL(baseDoc()) as any;
    expect(p2.app.icon).toBe("🤖");
  });

  it("节点 data.dataset_ids 归一化为占位符（保留长度）", () => {
    const p = projectDSL(baseDoc()) as any;
    const n1 = p.workflow.graph.nodes.find((n: any) => n.id === "n1");
    expect(n1.data.dataset_ids).toHaveLength(2);
    expect(n1.data.dataset_ids[0]).not.toBe("ds-1");
  });

  it("model_config.dataset_configs 内 dataset.id 归一化", () => {
    const doc = {
      app: { name: "A", mode: "chat" },
      model_config: {
        dataset_configs: {
          datasets: {
            datasets: [
              { dataset: { id: "ds-aaa", name: "k" } },
              { dataset: { id: "ds-bbb" } },
            ],
          },
        },
      },
    };
    const p = projectDSL(doc) as any;
    const ds = p.model_config.dataset_configs.datasets.datasets;
    expect(ds[0].dataset.id).not.toBe("ds-aaa");
    expect(ds[1].dataset.id).not.toBe("ds-bbb");
    expect(ds).toHaveLength(2);
  });

  it("nodes / edges 按 id 排序后比较（输入乱序不影响结果）", () => {
    const doc1 = baseDoc();
    const doc2 = baseDoc();
    // 交换节点顺序
    doc2.workflow.graph.nodes = [doc2.workflow.graph.nodes[1], doc2.workflow.graph.nodes[0]];
    const p1 = projectDSL(doc1);
    const p2 = projectDSL(doc2);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it("真实内容差异仍然可见（例如 prompt 变化）", () => {
    const a = projectDSL(baseDoc());
    const b = projectDSL(baseDoc());
    (b as any).workflow.graph.nodes[0].data.title = "改了";
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("YAML 字符串先 parse 再投影的端到端路径", () => {
    const yaml = stringifyYaml(baseDoc());
    const p = projectDSL(parseYaml(yaml)) as any;
    expect("version" in p).toBe(false);
    expect(p.app.name).toBe("A");
  });
});
