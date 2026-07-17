import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import type { AppConfig } from "../config.js";

export interface StoredObjectInfo {
  size: number;
  etag?: string;
}

export interface StoredObjectChecksum extends StoredObjectInfo {
  sha256: string;
}

export interface SignedUpload {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresIn: number;
  objectKey: string;
}

export interface QuestionBankStorage {
  put(objectKey: string, body: Buffer, contentType: string): Promise<StoredObjectInfo>;
  get(objectKey: string): Promise<Buffer>;
  head(objectKey: string): Promise<StoredObjectInfo | null>;
  checksum(objectKey: string): Promise<StoredObjectChecksum>;
  list(prefix: string): Promise<string[]>;
  delete(objectKey: string): Promise<void>;
  signedUpload(objectKey: string, contentType: string, expiresIn?: number): Promise<SignedUpload>;
  publicUrl(objectKey: string): string;
}

class LocalQuestionBankStorage implements QuestionBankStorage {
  constructor(private readonly root: string) {}

  private path(objectKey: string): string {
    const safe = objectKey.replaceAll("\\", "/").replace(/^\/+/, "");
    const root = resolve(this.root);
    const target = resolve(root, safe);
    const child = relative(root, target);
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("对象路径越界");
    return target;
  }

  async put(objectKey: string, body: Buffer): Promise<StoredObjectInfo> {
    const target = this.path(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { size: body.length };
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.path(objectKey));
  }

  async head(objectKey: string): Promise<StoredObjectInfo | null> {
    try { return { size: (await stat(this.path(objectKey))).size }; }
    catch { return null; }
  }

  async checksum(objectKey: string): Promise<StoredObjectChecksum> {
    const target = this.path(objectKey);
    const hash = createHash("sha256");
    let size = 0;
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(target);
      stream.on("data", (chunk: string | Buffer) => { const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk; size += value.length; hash.update(value); });
      stream.on("end", resolvePromise);
      stream.on("error", reject);
    });
    return { size, sha256: hash.digest("hex") };
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.path(prefix.replace(/\/$/, ""));
    const root = resolve(this.root);
    const results: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const target = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else if (entry.isFile()) results.push(relative(root, target).replaceAll("\\", "/"));
      }
    };
    await visit(base);
    return results.sort();
  }

  async delete(objectKey: string): Promise<void> {
    try { await unlink(this.path(objectKey)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async signedUpload(): Promise<SignedUpload> {
    throw new Error("本地存储不支持浏览器直传，请使用管理 API 代理上传");
  }

  publicUrl(objectKey: string): string {
    return `/api/v1/admin/media/local/${encodeURIComponent(objectKey)}`;
  }
}

class CosQuestionBankStorage implements QuestionBankStorage {
  private readonly cos: COS;

  constructor(private readonly config: AppConfig) {
    this.cos = new COS({ SecretId: config.cosSecretId, SecretKey: config.cosSecretKey });
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<StoredObjectInfo> {
    return new Promise((resolvePromise, reject) => {
      this.cos.putObject({
        Bucket: this.config.cosBucket,
        Region: this.config.cosRegion,
        Key: objectKey,
        Body: body,
        ContentType: contentType
      }, (error, data) => error ? reject(error) : resolvePromise({ size: body.length, etag: data.ETag }));
    });
  }

  async get(objectKey: string): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
      this.cos.getObject({ Bucket: this.config.cosBucket, Region: this.config.cosRegion, Key: objectKey }, (error, data) => {
        if (error) reject(error);
        else resolvePromise(Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as unknown as string));
      });
    });
  }

  async head(objectKey: string): Promise<StoredObjectInfo | null> {
    return new Promise((resolvePromise, reject) => {
      this.cos.headObject({ Bucket: this.config.cosBucket, Region: this.config.cosRegion, Key: objectKey }, (error, data) => {
        if (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404) resolvePromise(null);
          else reject(error);
        } else {
          resolvePromise({ size: Number(data.headers?.["content-length"] || 0), etag: data.headers?.etag });
        }
      });
    });
  }

  async checksum(objectKey: string): Promise<StoredObjectChecksum> {
    const output = new PassThrough();
    const hash = createHash("sha256");
    let size = 0;
    const consumed = new Promise<void>((resolvePromise, reject) => {
      output.on("data", (chunk: string | Buffer) => {
        const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += value.length;
        hash.update(value);
      });
      output.on("end", resolvePromise);
      output.on("error", reject);
    });
    await Promise.all([
      this.cos.getObject({ Bucket: this.config.cosBucket, Region: this.config.cosRegion, Key: objectKey, Output: output }),
      consumed
    ]);
    return { size, sha256: hash.digest("hex") };
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let marker: string | undefined;
    for (;;) {
      const data = await this.cos.getBucket({
        Bucket: this.config.cosBucket,
        Region: this.config.cosRegion,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000
      });
      keys.push(...(data.Contents || []).map((item) => item.Key));
      if (String(data.IsTruncated) !== "true" || !data.NextMarker) break;
      marker = data.NextMarker;
    }
    return keys.sort();
  }

  async delete(objectKey: string): Promise<void> {
    await this.cos.deleteObject({ Bucket: this.config.cosBucket, Region: this.config.cosRegion, Key: objectKey });
  }

  async signedUpload(objectKey: string, contentType: string, expiresIn = 600): Promise<SignedUpload> {
    const authorization = this.cos.getAuth({
      Method: "PUT",
      Key: objectKey,
      Expires: expiresIn,
      Bucket: this.config.cosBucket,
      Region: this.config.cosRegion
    });
    const host = `${this.config.cosBucket}.cos.${this.config.cosRegion}.myqcloud.com`;
    return {
      method: "PUT",
      url: `https://${host}/${objectKey.split("/").map(encodeURIComponent).join("/")}`,
      headers: { Authorization: authorization, "Content-Type": contentType },
      expiresIn,
      objectKey
    };
  }

  publicUrl(objectKey: string): string {
    // COS buckets are commonly private. Only expose a direct object URL when
    // an operator has explicitly configured a public/CDN base; otherwise the
    // media service serves the verified object through /api/v1/media/:id.
    const base = this.config.cosPublicBaseUrl;
    if (!base) return "";
    return `${base.replace(/\/$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  }
}

export function createQuestionBankStorage(config: AppConfig): QuestionBankStorage {
  return config.questionBankStorage === "cos"
    ? new CosQuestionBankStorage(config)
    : new LocalQuestionBankStorage(resolve(config.questionBankStorageDir));
}
