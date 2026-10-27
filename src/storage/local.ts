import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import type { StorageBackend } from "./interface.js";

export class LocalStorage implements StorageBackend {
  private basePath: string;

  constructor(config: { path: string }) {
    this.basePath = resolve(config.path);
    mkdirSync(this.basePath, { recursive: true });
  }

  async write(path: string, content: string | Buffer): Promise<void> {
    const fullPath = resolve(this.basePath, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    if (Buffer.isBuffer(content)) {
      writeFileSync(fullPath, content);
    } else {
      writeFileSync(fullPath, content, "utf-8");
    }
  }

  async read(path: string): Promise<string> {
    const fullPath = resolve(this.basePath, path);
    return readFileSync(fullPath, "utf-8");
  }

  async list(prefix = ""): Promise<string[]> {
    const dir = resolve(this.basePath, prefix);
    if (!existsSync(dir)) return [];
    return walkDir(dir).map((f) => relative(this.basePath, f).replaceAll("\\", "/"));
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(resolve(this.basePath, path));
  }

  async delete(path: string): Promise<void> {
    const fullPath = resolve(this.basePath, path);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  }

  async testConnection(): Promise<boolean> {
    try {
      mkdirSync(this.basePath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}
