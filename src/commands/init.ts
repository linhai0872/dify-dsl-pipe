import type { Command } from "commander";
import { writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as toYaml, parse as parseYaml } from "yaml";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { PipeError } from "../core/errors.js";
import { log, setJsonMode } from "../utils/logger.js";

interface InitOpts {
  name?: string;
  url?: string;
  token?: string;
  email?: string;
  password?: string;
  workspace?: string;
  storagePath?: string;
  out: string;
  force?: boolean;
  json?: boolean;
}

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("创建配置文件（交互向导，或 --name 非交互）")
    .option("--name <name>", "实例/Profile 名称（提供后进入非交互模式）")
    .option("--url <url>", "Dify Console API 地址")
    .option("--token <token>", "Access Token")
    .option("--email <email>", "登录邮箱")
    .option("--password <password>", "登录密码")
    .option("--workspace <id>", "Workspace ID")
    .option("--storage-path <dir>", "本地存储路径（默认 ./dify-backup/<name>）")
    .option("-o, --out <path>", "输出路径", "dify-pipe.yaml")
    .option("--force", "同名 instance/profile 已存在时覆盖")
    .option("--json", "JSON 格式输出")
    .action(async (opts: InitOpts) => {
      if (opts.name) return runNonInteractive(opts);
      return runInteractive(opts);
    });
}

async function runNonInteractive(opts: InitOpts) {
  if (opts.json) setJsonMode(true);
  const outPath = resolve(opts.out);

  try {
    const name = opts.name!;
    if (!opts.url) {
      throw new PipeError("ERR_CONFIG_INVALID", "缺少 --url（Dify Console API 地址）");
    }
    const hasToken = !!opts.token;
    const hasEmailPassword = !!opts.email && !!opts.password;
    if (!hasToken && !hasEmailPassword) {
      throw new PipeError(
        "ERR_CONFIG_INVALID",
        "缺少认证信息：请提供 --token，或 --email 与 --password"
      );
    }

    // 读取已有配置（保留其他 instance/profile/defaults）
    let raw: Record<string, unknown> = {};
    if (existsSync(outPath)) {
      const parsed = parseYaml(readFileSync(outPath, "utf-8"));
      if (parsed && typeof parsed === "object") {
        raw = parsed as Record<string, unknown>;
      }
    }

    const instances = Array.isArray(raw.instances)
      ? (raw.instances as Record<string, unknown>[])
      : [];
    const profiles =
      raw.profiles && typeof raw.profiles === "object"
        ? (raw.profiles as Record<string, unknown>)
        : {};

    const instExists = instances.some((i) => i && i.name === name);
    const profileExists = name in profiles;
    if ((instExists || profileExists) && !opts.force) {
      throw new PipeError(
        "ERR_CONFIG_INVALID",
        `实例或 profile "${name}" 已存在，使用 --force 覆盖`
      );
    }

    const instance: Record<string, unknown> = { name, url: opts.url };
    if (hasToken) {
      instance.token = opts.token;
    } else {
      instance.email = opts.email;
      instance.password = opts.password;
    }

    const profile: Record<string, unknown> = {
      instance: name,
      storage: {
        type: "local",
        path: opts.storagePath ?? `./dify-backup/${name}`,
      },
    };
    if (opts.workspace) profile.workspace = opts.workspace;

    const rest = instances.filter((i) => i && i.name !== name);
    raw.instances = [...rest, instance];
    raw.profiles = { ...profiles, [name]: profile };

    // 含凭据：仅所有者可读写。已有文件先收紧权限再写（mode 只对新建文件生效）
    if (existsSync(outPath)) chmodSync(outPath, 0o600);
    writeFileSync(outPath, toYaml(raw, { indent: 2 }), { encoding: "utf-8", mode: 0o600 });

    if (opts.json) {
      console.log(JSON.stringify({ success: true, path: outPath }));
    } else {
      log.success(`配置已写入 ${pc.green(outPath)}`);
      log.warn("配置文件包含凭据，请勿提交到代码仓库");
    }
    process.exit(0);
  } catch (e) {
    if (opts.json) {
      const pe =
        e instanceof PipeError
          ? e.toJSON()
          : { success: false, error: e instanceof Error ? e.message : String(e) };
      console.log(JSON.stringify(pe));
    } else {
      log.error(e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
}

async function runInteractive(opts: InitOpts) {
      const outPath = resolve(opts.out);

      if (existsSync(outPath)) {
        const overwrite = await p.confirm({
          message: `${outPath} 已存在，是否覆盖？`,
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          p.cancel("已取消");
          process.exit(0);
        }
      }

      p.intro(pc.bold("dify-dsl-pipe 配置向导"));

      const instance = await p.group(
        {
          name: () =>
            p.text({
              message: "实例名称（用于 --profile 切换）",
              placeholder: "prod",
              defaultValue: "default",
            }),
          url: () =>
            p.text({
              message: "Dify Console API 地址",
              placeholder: "https://dify.example.com/console/api",
              validate: (v) => {
                if (!v) return "地址不能为空";
                if (!v.startsWith("http")) return "请输入完整 URL（以 http 开头）";
              },
            }),
          authType: () =>
            p.select({
              message: "认证方式",
              options: [
                { value: "token", label: "Access Token（推荐）" },
                { value: "email", label: "邮箱 + 密码" },
              ],
            }),
          token: ({ results }) => {
            if (results.authType !== "token") return Promise.resolve(undefined);
            return p.text({
              message: "Access Token",
              placeholder: "从浏览器开发者工具获取",
              validate: (v) => (!v ? "Token 不能为空" : undefined),
            });
          },
          email: ({ results }) => {
            if (results.authType !== "email") return Promise.resolve(undefined);
            return p.text({ message: "登录邮箱" });
          },
          password: ({ results }) => {
            if (results.authType !== "email") return Promise.resolve(undefined);
            return p.password({ message: "登录密码" });
          },
        },
        { onCancel: () => { p.cancel("已取消"); process.exit(0); } }
      );

      const storage = await p.group(
        {
          type: () =>
            p.select({
              message: "存储后端",
              options: [
                { value: "local", label: "本地目录（默认）" },
                { value: "s3", label: "S3 兼容存储（AWS/阿里云/腾讯云/MinIO 等）" },
                { value: "git", label: "Git 仓库" },
              ],
            }),
          localPath: ({ results }) => {
            if (results.type !== "local") return Promise.resolve(undefined);
            return p.text({
              message: "本地存储路径",
              defaultValue: "./dify-backup",
            });
          },
          s3Bucket: ({ results }) => {
            if (results.type !== "s3") return Promise.resolve(undefined);
            return p.text({ message: "S3 Bucket 名称" });
          },
          s3Endpoint: ({ results }) => {
            if (results.type !== "s3") return Promise.resolve(undefined);
            return p.text({
              message: "S3 端点（留空使用 AWS 默认）",
              placeholder: "oss-cn-hangzhou.aliyuncs.com",
            });
          },
          s3Region: ({ results }) => {
            if (results.type !== "s3") return Promise.resolve(undefined);
            return p.text({ message: "S3 区域", defaultValue: "us-east-1" });
          },
          gitRepo: ({ results }) => {
            if (results.type !== "git") return Promise.resolve(undefined);
            return p.text({ message: "Git 仓库路径或 URL" });
          },
        },
        { onCancel: () => { p.cancel("已取消"); process.exit(0); } }
      );

      const exportOpts = await p.group(
        {
          pattern: () =>
            p.select({
              message: "文件命名方式",
              options: [
                { value: "by-type", label: "按类型分目录（推荐）: workflow/app_date.yml" },
                { value: "flat", label: "平铺: app_date.yml" },
                { value: "by-tag", label: "按标签分目录: tag/app_date.yml" },
                { value: "full", label: "完整路径: instance/workspace/type/app_date.yml" },
              ],
            }),
          includeVersions: () =>
            p.confirm({ message: "导出版本历史？", initialValue: true }),
        },
        { onCancel: () => { p.cancel("已取消"); process.exit(0); } }
      );

      // 组装配置
      const config: Record<string, unknown> = {
        instances: [buildInstance(instance)],
        profiles: {
          [String(instance.name)]: buildProfile(
            String(instance.name),
            storage,
            exportOpts
          ),
        },
      };

      writeFileSync(outPath, toYaml(config, { indent: 2 }), "utf-8");

      p.outro(`配置已写入 ${pc.green(outPath)}\n  运行 ${pc.cyan("npx dify-dsl-pipe export --profile " + instance.name)} 开始导出`);
}

function buildInstance(data: Record<string, unknown>) {
  const inst: Record<string, unknown> = {
    name: data.name,
    url: data.url,
  };
  if (data.token) inst.token = data.token;
  if (data.email) inst.email = data.email;
  if (data.password) inst.password = data.password;
  return inst;
}

function buildProfile(
  instanceName: string,
  storage: Record<string, unknown>,
  exportOpts: Record<string, unknown>
) {
  const profile: Record<string, unknown> = { instance: instanceName };

  if (storage.type === "local") {
    profile.storage = { type: "local", path: storage.localPath ?? "./dify-backup" };
  } else if (storage.type === "s3") {
    profile.storage = {
      type: "s3",
      bucket: storage.s3Bucket,
      endpoint: storage.s3Endpoint || undefined,
      region: storage.s3Region ?? "us-east-1",
      accessKeyId: "YOUR_ACCESS_KEY",
      secretAccessKey: "YOUR_SECRET_KEY",
    };
  } else if (storage.type === "git") {
    profile.storage = { type: "git", repo: storage.gitRepo };
  }

  profile.export = {
    pattern: exportOpts.pattern,
    includeVersionHistory: exportOpts.includeVersions,
  };

  return profile;
}
