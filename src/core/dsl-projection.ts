// 语义 projection（spec §5.6）：diff 默认模式两侧先做同一投影再深比较，
// 让报告只反映真实内容差异，忽略 Dify 导出噪声（画布坐标、变量 id、知识库 id 等）。
// 纯函数：返回深拷贝，不改输入。

const NODE_NOISE_KEYS = new Set([
  "position",
  "positionAbsolute",
  "selected",
  "width",
  "height",
  "dragging",
  "zIndex",
  "sourcePosition",
  "targetPosition",
]);

const EDGE_NOISE_KEYS = new Set(["selected", "zIndex"]);

/** dataset id 占位符——保留数组长度但抹掉具体 id。 */
const DATASET_ID_PLACEHOLDER = "__DATASET_ID__";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepClone) as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepClone(val);
    return out as T;
  }
  return v;
}

function stripKeys(obj: Record<string, unknown>, keys: Set<string>): void {
  for (const k of keys) delete obj[k];
}

function sortById(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return [...list].sort((a, b) => {
    const ia = isPlainObject(a) ? String(a.id ?? "") : "";
    const ib = isPlainObject(b) ? String(b.id ?? "") : "";
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/**
 * 归一化知识库 dataset id：
 * - 节点 data.dataset_ids[] 每项替换为占位符
 * - model_config.dataset_configs（chat 类应用的知识库配置，model_config 为顶层字段）
 *   内 datasets[].dataset.id 同样处理；结构示例：
 *   dataset_configs: { datasets: { datasets: [{ dataset: { id } }] } }
 * 数组长度保留，便于检测数量变化。
 */
function normalizeDatasetIds(root: Record<string, unknown>): void {
  const workflow = root.workflow;
  if (isPlainObject(workflow)) {
    const graph = workflow.graph;
    if (isPlainObject(graph) && Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        if (!isPlainObject(node)) continue;
        const data = node.data;
        if (isPlainObject(data) && Array.isArray(data.dataset_ids)) {
          data.dataset_ids = data.dataset_ids.map(() => DATASET_ID_PLACEHOLDER);
        }
      }
    }
  }

  // model_config 在 chat 类应用 DSL 中是顶层字段；防御性地也查 app.model_config
  const candidates = [root.model_config, (root.app as Record<string, unknown> | undefined)?.model_config];
  for (const modelConfig of candidates) {
    const dsCfgs = isPlainObject(modelConfig) ? modelConfig.dataset_configs : undefined;
    if (!isPlainObject(dsCfgs)) continue;

    // 兼容两种嵌套：datasets.datasets[] 与 datasets[] 直挂
    const datasetsWrapper = dsCfgs.datasets;
    const datasets = isPlainObject(datasetsWrapper)
      ? datasetsWrapper.datasets
      : datasetsWrapper;
    if (!Array.isArray(datasets)) continue;
    for (const entry of datasets) {
      if (!isPlainObject(entry)) continue;
      const ds = entry.dataset;
      if (isPlainObject(ds) && "id" in ds) ds.id = DATASET_ID_PLACEHOLDER;
      if ("dataset_id" in entry) entry.dataset_id = DATASET_ID_PLACEHOLDER;
    }
  }
}

/**
 * 对解析后的 DSL doc 做语义投影，返回投影后的新对象（输入不变）。
 * 删除的字段与 spec §5.6 一致：
 * - 顶层 version、dependencies
 * - workflow.graph.viewport
 * - 节点/边的画布与 UI 状态字段
 * - workflow.environment_variables[] / conversation_variables[] 的 id；
 *   env 变量中 value_type == "secret" 的 value 一并删除
 * - app.icon_type == "image" 时的 app.icon
 * - 知识库 dataset id → 占位符
 * - nodes / edges 按 id 排序
 */
export function projectDSL(doc: unknown): unknown {
  const root = deepClone(doc);
  if (!isPlainObject(root)) return root;

  delete root.version;
  delete root.dependencies;

  const app = root.app;
  if (isPlainObject(app) && app.icon_type === "image") {
    delete app.icon;
  }

  const workflow = root.workflow;
  if (isPlainObject(workflow)) {
    for (const key of ["environment_variables", "conversation_variables"] as const) {
      const vars = workflow[key];
      if (!Array.isArray(vars)) continue;
      for (const v of vars) {
        if (!isPlainObject(v)) continue;
        delete v.id;
        if (key === "environment_variables" && v.value_type === "secret") {
          delete v.value;
        }
      }
    }

    const graph = workflow.graph;
    if (isPlainObject(graph)) {
      delete graph.viewport;

      if (Array.isArray(graph.nodes)) {
        for (const node of graph.nodes) {
          if (isPlainObject(node)) stripKeys(node, NODE_NOISE_KEYS);
        }
        graph.nodes = sortById(graph.nodes);
      }
      if (Array.isArray(graph.edges)) {
        for (const edge of graph.edges) {
          if (isPlainObject(edge)) stripKeys(edge, EDGE_NOISE_KEYS);
        }
        graph.edges = sortById(graph.edges);
      }
    }
  }

  normalizeDatasetIds(root);
  return root;
}
