import { PipeError } from "./errors.js";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  text: string;
}

export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private headers: Record<string, string> = {};
  private cookies: Record<string, string> = {};

  constructor(baseUrl: string, timeout = 30, maxRetries = 3) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = timeout * 1000;
    this.maxRetries = maxRetries;
  }

  setHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  setCookie(key: string, value: string) {
    this.cookies[key] = value;
  }

  getCookie(key: string): string | undefined {
    return this.cookies[key];
  }

  private buildCookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private parseCookies(setCookieHeaders: string[]) {
    for (const header of setCookieHeaders) {
      const match = header.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this.cookies[match[1].trim()] = match[2].trim();
      }
    }
  }

  async request(method: string, endpoint: string, opts?: {
    params?: Record<string, string>;
    json?: unknown;
    raw?: boolean;
  }): Promise<HttpResponse> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      ...this.headers,
    };

    const cookieStr = this.buildCookieHeader();
    if (cookieStr) headers["cookie"] = cookieStr;

    let body: string | undefined;
    if (opts?.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url.toString(), {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const setCookies = response.headers.getSetCookie?.() ?? [];
        this.parseCookies(setCookies);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          responseHeaders[k.toLowerCase()] = v;
        });

        const text = await response.text();
        let jsonBody: unknown = text;
        try {
          jsonBody = JSON.parse(text);
        } catch {
          // not JSON
        }

        if (response.status >= 400) {
          const retryable = [429, 500, 502, 503, 504].includes(response.status);
          if (retryable && attempt < this.maxRetries) {
            lastError = new HttpError(response.status, `HTTP ${response.status}: ${text.slice(0, 200)}`);
            continue;
          }
          const httpError = new HttpError(response.status, `HTTP ${response.status}: ${text.slice(0, 500)}`);
          if (response.status === 403) {
            throw new PipeError(
              "ERR_FORBIDDEN",
              `${httpError.message}。可能是 RBAC 权限不足，请联系管理员检查 DSL 导入/导出（或发布）权限`,
              { cause: httpError },
            );
          }
          throw httpError;
        }

        return {
          status: response.status,
          headers: responseHeaders,
          body: jsonBody,
          text,
        };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = new Error(`请求超时 (${this.timeout / 1000}s)`);
        } else if (e instanceof HttpError || e instanceof PipeError) {
          throw e;
        } else {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
        if (attempt >= this.maxRetries) break;
      }
    }

    throw lastError ?? new Error("请求失败");
  }

  async get(endpoint: string, params?: Record<string, string>) {
    return this.request("GET", endpoint, { params });
  }

  async post(endpoint: string, json?: unknown) {
    return this.request("POST", endpoint, { json });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
