import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

let currentLevel: LogLevel = "info";
let jsonMode = false;

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  debug(msg: string, data?: Record<string, unknown>) {
    if (!shouldLog("debug")) return;
    if (jsonMode) return emitJson("debug", msg, data);
    console.error(pc.dim(`${timestamp()} ${msg}`));
  },

  info(msg: string, data?: Record<string, unknown>) {
    if (!shouldLog("info")) return;
    if (jsonMode) return emitJson("info", msg, data);
    console.error(`${pc.dim(timestamp())} ${msg}`);
  },

  success(msg: string, data?: Record<string, unknown>) {
    if (!shouldLog("info")) return;
    if (jsonMode) return emitJson("info", msg, data);
    console.error(`${pc.dim(timestamp())} ${pc.green("✓")} ${msg}`);
  },

  warn(msg: string, data?: Record<string, unknown>) {
    if (!shouldLog("warn")) return;
    if (jsonMode) return emitJson("warn", msg, data);
    console.error(`${pc.dim(timestamp())} ${pc.yellow("⚠")} ${msg}`);
  },

  error(msg: string, data?: Record<string, unknown>) {
    if (!shouldLog("error")) return;
    if (jsonMode) return emitJson("error", msg, data);
    console.error(`${pc.dim(timestamp())} ${pc.red("✗")} ${msg}`);
  },

  progress(current: number, total: number, label: string) {
    if (jsonMode) return;
    if (!shouldLog("info")) return;
    const pct = Math.round((current / total) * 100);
    const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
    process.stderr.write(`\r${pc.dim(timestamp())} ${bar} ${pct}% ${label}`);
    if (current >= total) process.stderr.write("\n");
  },
};

function emitJson(level: string, msg: string, data?: Record<string, unknown>) {
  const entry = { level, msg, ts: new Date().toISOString(), ...data };
  // JSON 模式下日志走 stderr，stdout 只留给命令最终输出的 PipeReport
  console.error(JSON.stringify(entry));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec}s`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
