import type { DifyApp } from "../core/types.js";

const PRESETS: Record<string, string> = {
  flat: "{name}.yml",
  "by-type": "{type}/{name}.yml",
  "by-tag": "{tags}/{name}_{date}.yml",
  "by-workspace": "{workspace}/{type}/{name}_{date}.yml",
  full: "{instance}/{workspace}/{type}/{name}_{date}.yml",
};

interface NamingContext {
  app: DifyApp;
  tags?: string[];
  instance?: string;
  workspace?: string;
  version?: string;
  date?: string;
}

export function resolvePattern(pattern: string): string {
  return PRESETS[pattern] ?? pattern;
}

export function buildFilePath(pattern: string, ctx: NamingContext): string {
  const resolved = resolvePattern(pattern);
  const date = ctx.date ?? formatDate(new Date());
  const tags = ctx.tags?.length ? ctx.tags.join("-") : "untagged";
  const safeName = sanitize(ctx.app.name);

  let path = resolved
    .replace("{name}", safeName)
    .replace("{type}", ctx.app.mode)
    .replace("{tags}", sanitize(tags))
    .replace("{date}", date)
    .replace("{id}", ctx.app.id.slice(0, 8))
    .replace("{instance}", sanitize(ctx.instance ?? "default"))
    .replace("{workspace}", sanitize(ctx.workspace ?? "default"))
    .replace("{version}", sanitize(ctx.version ?? "current"));

  // 清理多余的斜杠
  path = path.replace(/\/+/g, "/").replace(/^\//, "");
  return path;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function sanitize(name: string): string {
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  if (clean.length > 80) clean = clean.slice(0, 80);
  if (WIN_RESERVED.test(clean)) clean = `_${clean}`;
  return clean || "unnamed";
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function listPresets(): { name: string; pattern: string }[] {
  return Object.entries(PRESETS).map(([name, pattern]) => ({ name, pattern }));
}
