export type PipeErrorCode =
  | "ERR_NO_INSTANCE"
  | "ERR_INSTANCE_NOT_FOUND"
  | "ERR_AUTH_FAILED"
  | "ERR_CONNECTION_FAILED"
  | "ERR_STORAGE_CONNECT_FAILED"
  | "ERR_STORAGE_WRITE_FAILED"
  | "ERR_STORAGE_READ_FAILED"
  | "ERR_CONFIG_INVALID"
  | "ERR_PROFILE_NOT_FOUND"
  | "ERR_EXPORT_FAILED"
  | "ERR_IMPORT_FAILED"
  | "ERR_WORKSPACE_SWITCH_FAILED"
  | "ERR_VERSION_UNSUPPORTED";

export class PipeError extends Error {
  readonly code: PipeErrorCode;

  constructor(code: PipeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PipeError";
    this.code = code;
  }

  toJSON() {
    return { success: false, error: this.message, code: this.code };
  }
}
