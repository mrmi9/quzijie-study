import type { FastifyRequest } from "fastify";
import { AppError } from "../errors.js";

export interface CloudWechatIdentity {
  openId: string;
  unionId?: string;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] || "") : (value || "");
}

export function readCloudWechatIdentity(request: FastifyRequest): CloudWechatIdentity {
  const source = headerValue(request.headers["x-wx-source"]).trim();
  const openId = headerValue(request.headers["x-wx-openid"]).trim();
  const unionId = headerValue(request.headers["x-wx-unionid"]).trim();
  if (!source || !openId) {
    throw new AppError("请从当前小程序访问服务", "CLOUD_IDENTITY_MISSING", 401);
  }
  return unionId ? { openId, unionId } : { openId };
}
