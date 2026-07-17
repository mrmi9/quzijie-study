import "dotenv/config";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { createPrismaClient } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  ADMIN_ROLES,
  encryptAdminSecret,
  generateTotpSecret,
  hashAdminPassword,
  normalizeAdminRoles,
  normalizeAdminUsername,
  totpProvisioningUri
} from "../auth/admin.js";
import { requireInteractiveSecretTerminal } from "./admin-cli-security.js";

async function questionText(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function questionSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("密码操作只能在交互式终端中执行，禁止通过参数、重定向或管道传入密码");
  }
  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  output.write(prompt);
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
    };
    const onKeypress = (text: string, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("操作已取消"));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }
      if (!key.ctrl && !key.meta && text && !/[\r\n]/.test(text)) value += text;
    };
    input.on("keypress", onKeypress);
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] || "create";
  if (!["create", "reset-password", "reset-totp", "disable"].includes(command)) {
    throw new Error("用法：npm run admin:manage --workspace server -- create|reset-password|reset-totp|disable");
  }
  requireInteractiveSecretTerminal(command, input, output);
  const config = loadConfig({ ...process.env, ADMIN_ENABLED: "true" });
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const username = normalizeAdminUsername(await questionText("管理员用户名："));
    const existing = await prisma.adminUser.findUnique({ where: { username } });
    if (command === "create") {
      if (existing) throw new Error("管理员用户名已存在");
      const displayName = (await questionText("显示名称：")).normalize("NFKC").trim();
      if (displayName.length < 2 || displayName.length > 48) throw new Error("显示名称必须为 2 至 48 个字符");
      const password = await questionSecret("初始密码（至少 12 位，输入不回显）：");
      const requestedRoles = normalizeAdminRoles((await questionText(`权限（逗号分隔，默认 ${ADMIN_ROLES.join(",")}）：`)).split(",").map((item) => item.trim()).filter(Boolean));
      const roles = requestedRoles.length ? requestedRoles : Array.from(ADMIN_ROLES);
      const secret = generateTotpSecret();
      await prisma.$transaction(async (tx) => {
        const created = await tx.adminUser.create({
          data: {
            username,
            displayName,
            passwordHash: await hashAdminPassword(password),
            totpSecretEncrypted: encryptAdminSecret(secret, config.adminEncryptionKey),
            roles
          }
        });
        await tx.adminAuditLog.create({ data: { action: "admin.cli.create", entityType: "admin_user", entityId: created.id, afterState: { username, displayName, roles } } });
      });
      output.write(`\n管理员已创建。请立即录入验证器并妥善保管：\n密钥：${secret}\nURI：${totpProvisioningUri(username, secret)}\n`);
      return;
    }
    if (!existing) throw new Error("管理员不存在");
    if (command === "reset-password") {
      const password = await questionSecret("新密码（至少 12 位，输入不回显）：");
      await prisma.$transaction([
        prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash: await hashAdminPassword(password), passwordChangedAt: new Date() } }),
        prisma.adminSession.updateMany({ where: { adminUserId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.adminAuditLog.create({ data: { action: "admin.cli.reset-password", entityType: "admin_user", entityId: existing.id, afterState: { sessionsRevoked: true } } })
      ]);
      output.write("密码已重置，所有旧管理会话已撤销。\n");
    } else if (command === "reset-totp") {
      const secret = generateTotpSecret();
      await prisma.$transaction([
        prisma.adminUser.update({ where: { id: existing.id }, data: { totpSecretEncrypted: encryptAdminSecret(secret, config.adminEncryptionKey) } }),
        prisma.adminSession.updateMany({ where: { adminUserId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.adminAuditLog.create({ data: { action: "admin.cli.reset-totp", entityType: "admin_user", entityId: existing.id, afterState: { sessionsRevoked: true } } })
      ]);
      output.write(`新 TOTP 密钥：${secret}\nURI：${totpProvisioningUri(username, secret)}\n`);
    } else {
      await prisma.$transaction(async (tx) => {
        const current = await tx.adminUser.findUnique({ where: { id: existing.id } });
        if (!current) throw new Error("管理员不存在");
        if (current.status === "ACTIVE" && normalizeAdminRoles(current.roles).includes("OWNER")) {
          const activeAdministrators = await tx.adminUser.findMany({
            where: { status: "ACTIVE" },
            select: { roles: true }
          });
          const activeOwnerCount = activeAdministrators
            .filter((administrator) => normalizeAdminRoles(administrator.roles).includes("OWNER"))
            .length;
          if (activeOwnerCount <= 1) {
            throw new Error("必须保留至少一个启用的所有者，不能停用最后一个 OWNER");
          }
        }
        await tx.adminUser.update({ where: { id: current.id }, data: { status: "DISABLED" } });
        await tx.adminSession.updateMany({
          where: { adminUserId: current.id, revokedAt: null },
          data: { revokedAt: new Date() }
        });
        await tx.adminAuditLog.create({
          data: {
            action: "admin.cli.disable",
            entityType: "admin_user",
            entityId: current.id,
            beforeState: { status: current.status },
            afterState: { status: "DISABLED", sessionsRevoked: true }
          }
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      output.write("管理员已停用，所有会话已撤销。\n");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
