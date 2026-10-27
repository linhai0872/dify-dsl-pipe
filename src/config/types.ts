import { z } from "zod";

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  storage: z.string().optional(),
});

export const InstanceSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  email: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  workspaces: z.array(WorkspaceSchema).optional(),
  timeout: z.number().default(30),
  maxRetries: z.number().default(3),
});

export const LocalStorageSchema = z.object({
  type: z.literal("local"),
  path: z.string(),
});

export const S3StorageSchema = z.object({
  type: z.literal("s3"),
  endpoint: z.string().optional(),
  region: z.string().default("us-east-1"),
  bucket: z.string(),
  prefix: z.string().default(""),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  forcePathStyle: z.boolean().default(false),
});

export const GitStorageSchema = z.object({
  type: z.literal("git"),
  repo: z.string(),
  branch: z.string().default("main"),
  path: z.string().default("."),
  commitMessage: z.string().default("chore: dify dsl backup {date}"),
  authorName: z.string().default("dify-dsl-pipe"),
  authorEmail: z.string().default("dify-dsl-pipe@noreply"),
  push: z.boolean().default(true),
});

export const StorageSchema = z.discriminatedUnion("type", [
  LocalStorageSchema,
  S3StorageSchema,
  GitStorageSchema,
]);

export const ExportOptionsSchema = z.object({
  includeSecret: z.boolean().default(false),
  includeVersionHistory: z.boolean().default(true),
  incremental: z.boolean().default(false),
  archive: z.enum(["none", "zip"]).default("none"),
  pattern: z.string().default("{type}/{name}_{date}.yml"),
  sanitize: z.boolean().default(true),
  preserveLocalFiles: z.boolean().default(false),
  keepOriginal: z.boolean().default(false),
  filter: z
    .object({
      names: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      types: z.array(z.string()).optional(),
    })
    .optional(),
});

export const ImportOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  onConflict: z.enum(["skip", "overwrite"]).default("skip"),
  fix: z.boolean().default(false),
  publish: z.boolean().optional(),
  targetDifyVersion: z.string().optional(),
});

export const NotificationSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().url().optional(),
  onFailure: z.boolean().default(true),
  onSuccess: z.boolean().default(false),
});

export const ProfileSchema = z.object({
  instance: z.string(),
  workspace: z.string().optional(),
  storage: StorageSchema,
  export: ExportOptionsSchema.optional(),
  import: ImportOptionsSchema.optional(),
});

export const ConfigSchema = z.object({
  instances: z.array(InstanceSchema).default([]),
  profiles: z.record(z.string(), ProfileSchema).default({}),
  defaults: z
    .object({
      export: ExportOptionsSchema.optional(),
      import: ImportOptionsSchema.optional(),
      storage: StorageSchema.optional(),
      notification: NotificationSchema.optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type InstanceConfig = z.infer<typeof InstanceSchema>;
export type StorageConfig = z.infer<typeof StorageSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
export type ImportOptions = z.infer<typeof ImportOptionsSchema>;
export type ProfileConfig = z.infer<typeof ProfileSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;
