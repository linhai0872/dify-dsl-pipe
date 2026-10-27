export interface StorageBackend {
  /** 文本按 utf-8 写入；Buffer 按二进制写入。 */
  write(path: string, content: string | Buffer): Promise<void>;
  read(path: string): Promise<string>;
  list(prefix?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  testConnection(): Promise<boolean>;
  finalize?(): Promise<void>;
}
