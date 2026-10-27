import type { Command } from "commander";
import { serve } from "@hono/node-server";
import { setupPipe } from "../core/runner.js";
import { createApi, setWebhookUrl, stopAllJobs, type ServeContext, type NotificationConfig } from "../serve/api.js";
import { startMcpServer } from "../serve/mcp.js";
import { log, setJsonMode, setLogLevel } from "../utils/logger.js";
import pc from "picocolors";

export function registerServeCommand(program: Command) {
  program
    .command("serve")
    .description("启动 HTTP API 服务 / MCP Server")
    .option("--mcp", "以 MCP Server 模式启动 (stdio)")
    .option("--port <port>", "HTTP 端口", "3000")
    .option("--host <host>", "绑定地址", "127.0.0.1")
    .option("--url <url>", "Dify Console API 地址")
    .option("--token <token>", "Access Token")
    .option("--email <email>", "登录邮箱")
    .option("--password <password>", "登录密码")
    .option("--profile <name>", "使用配置文件中的 profile")
    .option("-c, --config <path>", "配置文件路径")
    .option("-o, --out <path>", "输出目录（本地存储时）", "./dify-backup")
    .option("--storage <type>", "存储类型: local, s3, git", "local")
    .option("--s3-bucket <bucket>", "S3 Bucket")
    .option("--s3-endpoint <endpoint>", "S3 端点")
    .option("--s3-region <region>", "S3 区域", "us-east-1")
    .option("--s3-access-key <key>", "S3 Access Key ID")
    .option("--s3-secret-key <key>", "S3 Secret Access Key")
    .option("--s3-force-path-style", "S3 强制 path-style（MinIO 必需）")
    .option("--git-repo <path>", "Git 仓库路径或 URL")
    .option("--git-branch <branch>", "Git 分支", "main")
    .option("--pattern <pattern>", "命名规则", "by-type")
    .option("--webhook <url>", "Webhook 通知地址")
    .option("--json", "JSON 格式输出")
    .option("--verbose", "详细日志")
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel("debug");

      try {
        const ctx = await setupPipe({
          url: opts.url,
          token: opts.token,
          email: opts.email,
          password: opts.password,
          profile: opts.profile,
          configPath: opts.config,
          storageType: opts.storage,
          out: opts.out,
          s3Bucket: opts.s3Bucket,
          s3Endpoint: opts.s3Endpoint,
          s3Region: opts.s3Region,
          s3AccessKey: opts.s3AccessKey,
          s3SecretKey: opts.s3SecretKey,
          s3ForcePathStyle: opts.s3ForcePathStyle,
          gitRepo: opts.gitRepo,
          gitBranch: opts.gitBranch,
        });

        if (opts.pattern && opts.pattern !== "by-type") {
          ctx.exportOpts.pattern = opts.pattern;
        }

        const notification: NotificationConfig | undefined = ctx.config.defaults?.notification?.enabled
          ? {
              enabled: true,
              onFailure: ctx.config.defaults.notification.onFailure ?? true,
              onSuccess: ctx.config.defaults.notification.onSuccess ?? false,
            }
          : undefined;

        const serveCtx: ServeContext = {
          clients: ctx.clients,
          storage: ctx.storage,
          exportOpts: ctx.exportOpts,
          importOpts: ctx.importOpts,
          notification,
        };

        const webhookFromConfig = ctx.config.defaults?.notification?.webhookUrl;
        if (opts.webhook || webhookFromConfig) {
          setWebhookUrl(opts.webhook ?? webhookFromConfig);
        }

        if (opts.mcp) {
          setLogLevel("silent");
          await startMcpServer({
            clients: ctx.clients,
            storage: ctx.storage,
            exportOpts: ctx.exportOpts,
            config: ctx.config,
          });
          return;
        }

        const api = createApi(serveCtx);
        const port = parseInt(opts.port, 10);
        const host = opts.host;

        const shutdown = () => {
          log.info("正在关闭...");
          stopAllJobs();
          process.exit(0);
        };

        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        if (process.platform === "win32") {
          process.on("SIGHUP", shutdown);
        }

        serve({ fetch: api.fetch, port, hostname: host }, () => {
          log.success(`HTTP API 已启动: ${pc.bold(`http://${host}:${port}`)}`);
          log.info(`已连接 ${ctx.clients.size} 个 Dify 实例`);
          log.info(`端点: POST /export, POST /import, GET /status, GET /jobs, POST /jobs`);
        });
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
