import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";
import type { QuestionBankStorage } from "./question-bank-storage.js";
import type { QuestionBankService } from "./question-bank.js";

const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
const MAX_MEDIA_BYTES = 1024 * 1024;
const MAX_MEDIA_DIMENSION = 4096;

type ImageInfo = { mimeType: string; width: number; height: number };

function jpegDimensions(body: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 8 < body.length) {
    if (body[offset] !== 0xff) { offset += 1; continue; }
    const marker = body[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = body.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > body.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: body.readUInt16BE(offset + 5), width: body.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(body: Buffer): { width: number; height: number } | null {
  const kind = body.subarray(12, 16).toString("ascii");
  if (kind === "VP8X" && body.length >= 30) {
    return { width: 1 + body.readUIntLE(24, 3), height: 1 + body.readUIntLE(27, 3) };
  }
  if (kind === "VP8 " && body.length >= 30 && body[23] === 0x9d && body[24] === 0x01 && body[25] === 0x2a) {
    return { width: body.readUInt16LE(26) & 0x3fff, height: body.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L" && body.length >= 25 && body[20] === 0x2f) {
    const bits = body.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function detectedImage(body: Buffer): ImageInfo | null {
  if (body.length >= 24 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    const dimensions = jpegDimensions(body);
    return dimensions ? { mimeType: "image/jpeg", ...dimensions } : null;
  }
  if (body.length >= 25 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") {
    const dimensions = webpDimensions(body);
    return dimensions ? { mimeType: "image/webp", ...dimensions } : null;
  }
  return null;
}

export function validateQuestionImage(body: Buffer, expectedMime: string): ImageInfo {
  const image = detectedImage(body);
  if (!image || image.mimeType !== expectedMime) throw new AppError("题图文件内容与格式不一致", "MEDIA_TYPE_INVALID", 400);
  if (image.width < 1 || image.height < 1 || image.width > MAX_MEDIA_DIMENSION || image.height > MAX_MEDIA_DIMENSION) {
    throw new AppError(`题图宽高必须在 1 至 ${MAX_MEDIA_DIMENSION} 像素之间`, "MEDIA_DIMENSIONS_INVALID", 400);
  }
  return image;
}

export class MediaService {
  constructor(private readonly prisma: DatabaseClient, private readonly storage: QuestionBankStorage, private readonly bank: QuestionBankService) {}

  private immutableObjectKey(sha256: string, mimeType: string): string {
    return `question-bank/media/sha256/${sha256}.${ALLOWED_MIME[mimeType]}`;
  }

  private async persistImmutable(objectKey: string, body: Buffer, mimeType: string, sha256: string): Promise<void> {
    await this.storage.put(objectKey, body, mimeType);
    const stored = await this.storage.head(objectKey);
    if (!stored || stored.size !== body.length) throw new AppError("题图对象写入后大小校验失败", "MEDIA_STORAGE_VALIDATION_FAILED", 502);
    const downloaded = await this.storage.get(objectKey);
    if (createHash("sha256").update(downloaded).digest("hex") !== sha256) {
      throw new AppError("题图对象写入后哈希校验失败", "MEDIA_STORAGE_VALIDATION_FAILED", 502);
    }
  }

  private publicUrl(id: string, objectKey: string): string {
    const storageUrl = this.storage.publicUrl(objectKey);
    return /^https:\/\//i.test(storageUrl) ? storageUrl : `/api/v1/media/${id}`;
  }

  async createSignedUpload(adminUserId: string, input: { fileName: string; mimeType: string; size: number }, requestId?: string) {
    const extension = ALLOWED_MIME[input.mimeType];
    if (!extension) throw new AppError("题图只支持 PNG、JPEG 和 WebP", "MEDIA_TYPE_INVALID", 400);
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_MEDIA_BYTES) throw new AppError("题图大小必须在 1MB 以内", "MEDIA_SIZE_INVALID", 400);
    const now = new Date();
    const id = randomUUID();
    const objectKey = `question-bank/media/uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${extension}`;
    const upload = await this.storage.signedUpload(objectKey, input.mimeType, 600);
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({ data: { id, objectKey, mimeType: input.mimeType, size: input.size, createdById: adminUserId } });
      await tx.adminAuditLog.create({ data: {
        adminUserId, action: "media.prepare", entityType: "media_asset", entityId: id,
        afterState: { objectKey, mimeType: input.mimeType, size: input.size, fileName: input.fileName }, requestId: requestId || null
      } });
      return created;
    });
    return { asset, upload };
  }

  async uploadThroughApi(adminUserId: string, fileName: string, mimeType: string, body: Buffer, requestId?: string) {
    const extension = ALLOWED_MIME[mimeType];
    if (!extension) throw new AppError("题图只支持 PNG、JPEG 和 WebP", "MEDIA_TYPE_INVALID", 400);
    if (!body.length || body.length > MAX_MEDIA_BYTES) throw new AppError("题图大小必须在 1MB 以内", "MEDIA_SIZE_INVALID", 400);
    const image = validateQuestionImage(body, mimeType);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const duplicate = await this.prisma.mediaAsset.findUnique({ where: { sha256 } });
    if (duplicate?.status === "READY") return duplicate;
    const id = randomUUID();
    const now = new Date();
    const objectKey = this.immutableObjectKey(sha256, mimeType);
    await this.persistImmutable(objectKey, body, mimeType, sha256);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            id,
            objectKey,
            mimeType,
            size: body.length,
            width: image.width,
            height: image.height,
            sha256,
            publicUrl: this.publicUrl(id, objectKey),
            status: "READY",
            readyAt: now,
            createdById: adminUserId
          }
        });
        await tx.adminAuditLog.create({ data: {
          adminUserId, action: "media.upload", entityType: "media_asset", entityId: id,
          afterState: { objectKey, mimeType, size: body.length, fileName, sha256 }, requestId: requestId || null
        } });
        return asset;
      });
    } catch (error) {
      const references = await this.prisma.mediaAsset.count({ where: { objectKey } });
      if (references === 0) await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async complete(adminUserId: string, id: string, requestId?: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new AppError("媒体资源不存在", "MEDIA_NOT_FOUND", 404);
    if (asset.status === "READY") return asset;
    const body = await this.storage.get(asset.objectKey);
    let image: ImageInfo;
    try { image = validateQuestionImage(body, asset.mimeType); }
    catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset.update({ where: { id }, data: { status: "REJECTED" } });
        await tx.adminAuditLog.create({ data: {
          adminUserId, action: "media.reject", entityType: "media_asset", entityId: id,
          beforeState: { status: asset.status }, afterState: { status: "REJECTED", reason: "content_or_type_invalid" }, requestId: requestId || null
        } });
      });
      if (error instanceof AppError) throw error;
      throw new AppError("上传文件校验失败", "MEDIA_VALIDATION_FAILED", 400);
    }
    if (body.length > MAX_MEDIA_BYTES || body.length !== asset.size) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset.update({ where: { id }, data: { status: "REJECTED" } });
        await tx.adminAuditLog.create({ data: {
          adminUserId, action: "media.reject", entityType: "media_asset", entityId: id,
          beforeState: { status: asset.status, expectedSize: asset.size }, afterState: { status: "REJECTED", actualSize: body.length, reason: "size_invalid" }, requestId: requestId || null
        } });
      });
      throw new AppError("上传文件校验失败", "MEDIA_VALIDATION_FAILED", 400);
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    const duplicate = await this.prisma.mediaAsset.findFirst({ where: { sha256, id: { not: id }, status: "READY" } });
    if (duplicate) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset.update({ where: { id }, data: { status: "REJECTED" } });
        await tx.adminAuditLog.create({ data: {
          adminUserId, action: "media.deduplicate", entityType: "media_asset", entityId: id,
          beforeState: { status: asset.status }, afterState: { status: "REJECTED", duplicateId: duplicate.id, sha256 }, requestId: requestId || null
        } });
      });
      return duplicate;
    }
    const immutableObjectKey = this.immutableObjectKey(sha256, asset.mimeType);
    await this.persistImmutable(immutableObjectKey, body, asset.mimeType, sha256);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.mediaAsset.update({
          where: { id },
          data: {
            objectKey: immutableObjectKey,
            sha256,
            width: image.width,
            height: image.height,
            publicUrl: this.publicUrl(id, immutableObjectKey),
            status: "READY",
            readyAt: new Date()
          }
        });
        await tx.adminAuditLog.create({ data: {
          adminUserId, action: "media.complete", entityType: "media_asset", entityId: id,
          beforeState: { status: asset.status, objectKey: asset.objectKey },
          afterState: { status: "READY", objectKey: immutableObjectKey, sha256, size: body.length }, requestId: requestId || null
        } });
        return updated;
      });
    } catch (error) {
      const references = await this.prisma.mediaAsset.count({ where: { objectKey: immutableObjectKey } });
      if (references === 0) await this.storage.delete(immutableObjectKey).catch(() => undefined);
      throw error;
    }
  }

  async list(query: { page?: number; pageSize?: number; status?: string } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const status = query.status ? String(query.status).toUpperCase() : undefined;
    if (status && !["PENDING", "READY", "REJECTED"].includes(status)) throw new AppError("媒体状态筛选值无效", "INVALID_MEDIA_FILTER", 400);
    const where = status ? { status: status as "PENDING" | "READY" | "REJECTED" } : {};
    const [total, items] = await Promise.all([
      this.prisma.mediaAsset.count({ where }),
      this.prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })
    ]);
    return { page, pageSize, total, items };
  }

  async readPublic(id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, status: "READY" } });
    if (!asset) throw new AppError("题图不存在", "MEDIA_NOT_FOUND", 404);
    return { asset, body: await this.storage.get(asset.objectKey) };
  }
}
