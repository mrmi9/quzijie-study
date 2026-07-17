import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const ADMIN_ROLES = ["OWNER", "EDITOR", "REVIEWER", "PUBLISHER"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeAdminUsername(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/.test(normalized)) throw new Error("管理员用户名格式无效");
  return normalized;
}

export function normalizeAdminRoles(value: unknown): AdminRole[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(String).filter((role): role is AdminRole => ADMIN_ROLES.includes(role as AdminRole))));
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) throw new Error("管理员密码必须为 12 至 128 个字符");
  return hash(password, { memoryCost: 19_456, timeCost: 3, parallelism: 1 });
}

export async function verifyAdminPassword(storedHash: string, password: string): Promise<boolean> {
  try { return await verify(storedHash, password); } catch { return false; }
}

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const raw of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32.indexOf(raw);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpProvisioningUri(username: string, secret: string): string {
  const issuer = "趣刷题喽题库管理";
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${username}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function totpAt(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function createTotpToken(secret: string, now = Date.now()): string {
  return totpAt(secret, Math.floor(now / 30_000));
}

export function verifyTotp(secret: string, token: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpAt(secret, counter + offset));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

function encryptionKey(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function encryptAdminSecret(secret: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptAdminSecret(value: string, keyMaterial: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("管理员密钥密文格式无效");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyMaterial), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySha256Secret(value: string, expectedHash: string): boolean {
  if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomSessionToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}
