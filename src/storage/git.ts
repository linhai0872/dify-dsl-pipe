import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import type { StorageBackend } from "./interface.js";

interface GitConfig {
  repo: string;
  branch: string;
  path: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  push: boolean;
}

export class GitStorage implements StorageBackend {
  private git!: SimpleGit;
  private workDir: string;
  private basePath: string;
  private config: GitConfig;
  private dirty = false;

  constructor(config: GitConfig) {
    this.config = config;
    this.workDir = resolve(config.repo);
    this.basePath = resolve(this.workDir, config.path);
  }

  private async ensureRepo() {
    if (!existsSync(resolve(this.workDir, ".git"))) {
      // 如果是 URL，先 clone
      if (this.config.repo.includes("://") || this.config.repo.includes("@")) {
        const tmpDir = resolve(process.cwd(), ".dify-pipe-git-tmp");
        const git = simpleGit();
        await git.clone(this.config.repo, tmpDir, ["--branch", this.config.branch, "--depth", "1"]);
        this.workDir = tmpDir;
        this.basePath = resolve(this.workDir, this.config.path);
      }
    }

    this.git = simpleGit(this.workDir);
    await this.git.addConfig("user.name", this.config.authorName);
    await this.git.addConfig("user.email", this.config.authorEmail);

    try {
      await this.git.checkout(this.config.branch);
    } catch {
      // branch 可能已经是当前分支
    }

    mkdirSync(this.basePath, { recursive: true });
  }

  async write(path: string, content: string | Buffer): Promise<void> {
    await this.ensureRepo();
    const fullPath = resolve(this.basePath, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    if (Buffer.isBuffer(content)) {
      writeFileSync(fullPath, content);
    } else {
      writeFileSync(fullPath, content, "utf-8");
    }
    this.dirty = true;
  }

  async read(path: string): Promise<string> {
    await this.ensureRepo();
    return readFileSync(resolve(this.basePath, path), "utf-8");
  }

  async list(prefix = ""): Promise<string[]> {
    await this.ensureRepo();
    const dir = resolve(this.basePath, prefix);
    if (!existsSync(dir)) return [];
    return walkDir(dir).map((f) => relative(this.basePath, f).replaceAll("\\", "/"));
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureRepo();
    return existsSync(resolve(this.basePath, path));
  }

  async delete(path: string): Promise<void> {
    await this.ensureRepo();
    const fullPath = resolve(this.basePath, path);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
      this.dirty = true;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.ensureRepo();
      return true;
    } catch {
      return false;
    }
  }

  async finalize(): Promise<void> {
    if (!this.dirty) return;

    await this.git.add(".");
    const message = this.config.commitMessage.replace(
      "{date}",
      new Date().toISOString().slice(0, 10)
    );
    await this.git.commit(message);

    if (this.config.push) {
      await this.git.push("origin", this.config.branch);
    }
  }
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git") continue;
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
