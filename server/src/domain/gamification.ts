import { createHash } from "node:crypto";
import { AppError } from "../errors.js";

const RESERVED = ["管理员", "官方", "系统", "客服", "趣刷题喽", "趣字节"];
const SENSITIVE = ["赌博", "博彩", "色情", "约炮", "代考", "外挂", "诈骗", "傻逼", "操你", "去死"];
const CONTACT = /(微信|wechat|\bwx\b|qq|vx|加我|联系我)|\d{7,}/iu;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_]{1,11}$/u;

export const NICKNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function publicCodeFor(userId: string, salt = 0): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digest = createHash("sha256").update(`quzijie:${userId}:${salt}`).digest();
  let value = digest.readUInt32BE(0);
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return code;
}

export function normalizeDisplayName(value: unknown): string {
  const normalized = String(value || "").normalize("NFKC").trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > 12 || !NAME_PATTERN.test(normalized)) {
    throw new AppError("昵称仅支持 2–12 位中文、字母、数字和下划线", "INVALID_DISPLAY_NAME", 400);
  }
  const lower = normalized.toLocaleLowerCase("zh-CN");
  if (RESERVED.some((word) => lower.includes(word.toLocaleLowerCase("zh-CN")))) {
    throw new AppError("昵称包含系统保留词", "RESERVED_DISPLAY_NAME", 400);
  }
  if (SENSITIVE.some((word) => lower.includes(word)) || CONTACT.test(lower)) {
    throw new AppError("昵称包含不适合公开展示的内容", "UNSAFE_DISPLAY_NAME", 400);
  }
  return normalized;
}

export function shanghaiDayKey(value: Date): string {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function shanghaiPeriod(period: "daily" | "weekly" | "all", now = new Date()): { start: Date | null; end: Date | null } {
  if (period === "all") return { start: null, end: null };
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dayStartUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  let startShifted = dayStartUtc;
  if (period === "weekly") {
    const day = shifted.getUTCDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    startShifted -= daysSinceMonday * 24 * 60 * 60 * 1000;
  }
  const duration = period === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const offset = 8 * 60 * 60 * 1000;
  return { start: new Date(startShifted - offset), end: new Date(startShifted + duration - offset) };
}
