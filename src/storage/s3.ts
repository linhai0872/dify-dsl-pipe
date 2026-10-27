import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageBackend } from "./interface.js";

interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ? config.prefix.replace(/\/+$/, "") + "/" : "";

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
    });
  }

  private key(path: string): string {
    return `${this.prefix}${path}`;
  }

  async write(path: string, content: string | Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(path),
        Body: content,
        ...(Buffer.isBuffer(content)
          ? {}
          : { ContentType: "text/yaml; charset=utf-8" }),
      })
    );
  }

  async read(path: string): Promise<string> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) })
    );
    return (await res.Body?.transformToString("utf-8")) ?? "";
  }

  async list(prefix = ""): Promise<string[]> {
    const fullPrefix = this.key(prefix);
    const files: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) {
          files.push(obj.Key.slice(this.prefix.length));
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return files;
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(path) })
    );
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 })
      );
      return true;
    } catch {
      return false;
    }
  }
}
