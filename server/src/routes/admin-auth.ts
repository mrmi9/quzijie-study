import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseClient } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import QRCode from "qrcode";
import { AppError } from "../errors.js";
import {
  ADMIN_ROLES,
  decryptAdminSecret,
  encryptAdminSecret,
  generateTotpSecret,
  hashAdminPassword,
  normalizeAdminRoles,
  normalizeAdminUsername,
  randomSessionToken,
  sha256,
  totpProvisioningUri,
  verifyAdminPassword,
  verifySha256Secret,
  verifyTotp,
  type AdminRole
} from "../auth/admin.js";

const COOKIE_NAME = "qz_admin_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const INVALID_LOGIN_IDENTITY = "__invalid_admin_username__";

/**
 * Login throttling is deliberately scoped to the normalized account name,
 * rather than request.ip. CloudRun can present the same reverse-proxy address
 * for unrelated administrators, and this service does not blindly trust
 * client-controlled forwarding headers. The database-backed failed-login lock
 * remains the cross-instance protection for real accounts.
 */
export function adminLoginRateLimitKey(request: FastifyRequest): string {
  const body = request.body as { username?: unknown } | null | undefined;
  let identity = INVALID_LOGIN_IDENTITY;
  if (typeof body?.username === "string") {
    try { identity = normalizeAdminUsername(body.username); }
    catch { identity = INVALID_LOGIN_IDENTITY; }
  }
  return `admin-login:${sha256(identity)}`;
}

function adminView(user: { id: string; username: string; displayName: string; roles: unknown }) {
  return { id: user.id, username: user.username, displayName: user.displayName, roles: normalizeAdminRoles(user.roles) };
}

/**
 * Atomically records one failed login without allowing concurrent requests to
 * overwrite each other's counter. A bounded CAS loop turns sustained database
 * contention into a temporary error instead of silently losing a failure.
 */
export async function recordFailedAdminLogin(prisma: DatabaseClient, adminUserId: string, now = new Date()): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const current = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { status: true, failedLoginCount: true, lockedUntil: true }
    });
    if (!current || current.status !== "ACTIVE" || (current.lockedUntil && current.lockedUntil > now)) return;

    const shouldLock = current.failedLoginCount + 1 >= 5;
    const updated = await prisma.adminUser.updateMany({
      where: {
        id: adminUserId,
        status: "ACTIVE",
        failedLoginCount: current.failedLoginCount,
        lockedUntil: current.lockedUntil
      },
      data: {
        failedLoginCount: shouldLock ? 0 : { increment: 1 },
        lockedUntil: shouldLock ? new Date(now.getTime() + 15 * 60_000) : null
      }
    });
    if (updated.count === 1) return;
  }
  throw new AppError("登录安全状态更新冲突，请稍后重试", "ADMIN_LOGIN_STATE_CONFLICT", 503);
}

export async function recordFailedAdminStepUp(prisma: DatabaseClient, sessionId: string, now = new Date()): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const current = await prisma.adminSession.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, stepUpFailedCount: true }
    });
    if (!current || current.revokedAt) return;
    const revoke = current.stepUpFailedCount + 1 >= 5;
    const updated = await prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null, stepUpFailedCount: current.stepUpFailedCount },
      data: {
        stepUpFailedCount: revoke ? 0 : { increment: 1 },
        stepUpLockedUntil: revoke ? new Date(now.getTime() + 15 * 60_000) : null,
        ...(revoke ? { revokedAt: now } : {})
      }
    });
    if (updated.count === 1) return;
  }
  throw new AppError("二次验证安全状态更新冲突，请稍后重试", "ADMIN_STEP_UP_STATE_CONFLICT", 503);
}

export class AdminSecurity {
  constructor(private readonly prisma: DatabaseClient, private readonly config: AppConfig) {}

  get reviewPolicy() { return this.config.adminReviewPolicy; }

  authenticate = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!this.config.adminEnabled) throw new AppError("管理后台未启用", "ADMIN_DISABLED", 404);
    const token = request.cookies[COOKIE_NAME];
    if (!token) throw new AppError("管理员登录已失效", "ADMIN_UNAUTHORIZED", 401);
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { adminUser: true }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.adminUser.status !== "ACTIVE") {
      throw new AppError("管理员登录已失效", "ADMIN_UNAUTHORIZED", 401);
    }
    if (!SAFE_METHODS.has(request.method)) {
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || sha256(csrf) !== session.csrfTokenHash) {
        throw new AppError("CSRF 校验失败，请刷新管理页面", "ADMIN_CSRF_INVALID", 403);
      }
    }
    request.adminUser = { ...adminView(session.adminUser), sessionId: session.id };
  };

  requireRole(...allowed: AdminRole[]): preHandlerHookHandler {
    return async (request, reply): Promise<void> => {
      await this.authenticate(request, reply);
      if (!request.adminUser || !request.adminUser.roles.some((role) => allowed.includes(role))) {
        throw new AppError("当前管理员没有执行该操作的权限", "ADMIN_FORBIDDEN", 403);
      }
    };
  }

  async verifyStepUp(request: FastifyRequest, token: string): Promise<void> {
    const sessionId = request.adminUser?.sessionId;
    if (!sessionId) throw new AppError("管理员登录已失效", "ADMIN_UNAUTHORIZED", 401);
    const session = await this.prisma.adminSession.findUnique({
      where: { id: sessionId },
      include: { adminUser: true }
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || session.stepUpLockedUntil && session.stepUpLockedUntil > now) {
      throw new AppError("管理员登录已失效", "ADMIN_UNAUTHORIZED", 401);
    }
    let verified = false;
    try {
      verified = verifyTotp(decryptAdminSecret(session.adminUser.totpSecretEncrypted, this.config.adminEncryptionKey), token);
    } catch {
      verified = false;
    }
    if (!verified) {
      await recordFailedAdminStepUp(this.prisma, session.id, now);
      throw new AppError("动态验证码不正确", "ADMIN_STEP_UP_FAILED", 401);
    }
    await this.prisma.adminSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { stepUpFailedCount: 0, stepUpLockedUntil: null }
    });
  }
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: config.adminSessionTtlHours * 60 * 60
  });
}

export function registerAdminAuthRoutes(
  app: FastifyInstance,
  prisma: DatabaseClient,
  config: AppConfig,
  security: AdminSecurity
): void {
  const ensureSetupAvailable = async (): Promise<void> => {
    const [administratorCount, bootstrapStateCount] = await Promise.all([
      prisma.adminUser.count(),
      prisma.adminBootstrapState.count()
    ]);
    if (!config.adminBootstrapTokenHash || administratorCount > 0 || bootstrapStateCount > 0) {
      throw new AppError("初始化入口不存在", "NOT_FOUND", 404);
    }
  };

  const verifyBootstrapToken = (token: string): void => {
    if (!verifySha256Secret(token, config.adminBootstrapTokenHash)) {
      throw new AppError("初始化凭据无效", "ADMIN_BOOTSTRAP_TOKEN_INVALID", 401);
    }
  };

  app.get("/api/v1/admin/setup/status", async () => {
    await ensureSetupAvailable();
    return { data: { available: true } };
  });

  app.post<{ Body: { bootstrapToken: string; username?: string } }>("/api/v1/admin/setup/prepare", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["bootstrapToken"],
        properties: {
          bootstrapToken: { type: "string", minLength: 32, maxLength: 512 },
          username: { type: "string", minLength: 3, maxLength: 63, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$" }
        }
      }
    }
  }, async (request) => {
    await ensureSetupAvailable();
    verifyBootstrapToken(request.body.bootstrapToken);
    const secret = generateTotpSecret();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const setupToken = encryptAdminSecret(JSON.stringify({ version: 1, secret, expiresAt: expiresAt.toISOString() }), config.adminEncryptionKey);
    let totpUsername = "owner";
    if (request.body.username) {
      try { totpUsername = normalizeAdminUsername(request.body.username); }
      catch { throw new AppError("管理员用户名格式无效", "ADMIN_USERNAME_INVALID", 400); }
    }
    const totpUri = totpProvisioningUri(totpUsername, secret);
    return {
      data: {
        setupToken,
        totpSecret: secret,
        totpUri,
        qrCodeDataUrl: await QRCode.toDataURL(totpUri, { errorCorrectionLevel: "M", margin: 1, width: 256 }),
        expiresAt: expiresAt.toISOString()
      }
    };
  });

  app.post<{ Body: { bootstrapToken: string; setupToken: string; username: string; displayName: string; password: string; totp: string } }>("/api/v1/admin/setup/complete", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    schema: {
      body: {
        type: "object", additionalProperties: false,
        required: ["bootstrapToken", "setupToken", "username", "displayName", "password", "totp"],
        properties: {
          bootstrapToken: { type: "string", minLength: 32, maxLength: 512 },
          setupToken: { type: "string", minLength: 32, maxLength: 4096 },
          username: { type: "string", minLength: 3, maxLength: 63, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$" },
          displayName: { type: "string", minLength: 1, maxLength: 96 },
          password: { type: "string", minLength: 12, maxLength: 128 },
          totp: { type: "string", pattern: "^[0-9]{6}$" }
        }
      }
    }
  }, async (request) => {
    await ensureSetupAvailable();
    verifyBootstrapToken(request.body.bootstrapToken);
    let challenge: { version: number; secret: string; expiresAt: string };
    try {
      challenge = JSON.parse(decryptAdminSecret(request.body.setupToken, config.adminEncryptionKey)) as typeof challenge;
    } catch {
      throw new AppError("初始化会话无效或已过期", "ADMIN_SETUP_TOKEN_INVALID", 401);
    }
    if (challenge.version !== 1 || !challenge.secret || !challenge.expiresAt || new Date(challenge.expiresAt) <= new Date()) {
      throw new AppError("初始化会话无效或已过期", "ADMIN_SETUP_TOKEN_INVALID", 401);
    }
    if (!verifyTotp(challenge.secret, request.body.totp)) {
      throw new AppError("动态验证码不正确", "ADMIN_SETUP_TOTP_INVALID", 401);
    }
    let username: string;
    try { username = normalizeAdminUsername(request.body.username); }
    catch { throw new AppError("管理员用户名格式无效", "ADMIN_USERNAME_INVALID", 400); }
    const displayName = request.body.displayName.normalize("NFKC").trim();
    if (!displayName) throw new AppError("管理员显示名称不能为空", "ADMIN_DISPLAY_NAME_REQUIRED", 400);
    const passwordHash = await hashAdminPassword(request.body.password);
    try {
      const created = await prisma.$transaction(async (tx) => {
        if (await tx.adminUser.count() > 0 || await tx.adminBootstrapState.count() > 0) {
          throw new AppError("初始化入口不存在", "NOT_FOUND", 404);
        }
        const user = await tx.adminUser.create({
          data: {
            username,
            displayName,
            passwordHash,
            totpSecretEncrypted: encryptAdminSecret(challenge.secret, config.adminEncryptionKey),
            roles: [...ADMIN_ROLES]
          }
        });
        await tx.adminBootstrapState.create({ data: { id: 1, adminUserId: user.id } });
        await tx.adminAuditLog.create({
          data: {
            adminUserId: user.id,
            action: "admin.bootstrap.complete",
            entityType: "admin_user",
            entityId: user.id,
            afterState: { username: user.username, roles: user.roles },
            requestId: request.id
          }
        });
        return user;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { data: { user: adminView(created), completed: true } };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "P2002" || code === "P2034") throw new AppError("初始化入口不存在", "NOT_FOUND", 404);
      throw error;
    }
  });

  app.post<{ Body: { username: string; password: string; totp: string } }>("/api/v1/admin/auth/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "10 minutes",
        hook: "preValidation",
        keyGenerator: adminLoginRateLimitKey
      }
    },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password", "totp"],
        properties: {
          username: { type: "string", minLength: 3, maxLength: 64 },
          password: { type: "string", minLength: 1, maxLength: 128 },
          totp: { type: "string", pattern: "^[0-9]{6}$" }
        }
      }
    }
  }, async (request, reply) => {
    if (!config.adminEnabled) throw new AppError("管理后台未启用", "ADMIN_DISABLED", 404);
    let username: string;
    try { username = normalizeAdminUsername(request.body.username); }
    catch { throw new AppError("用户名、密码或动态验证码不正确", "ADMIN_LOGIN_FAILED", 401); }
    const user = await prisma.adminUser.findUnique({ where: { username } });
    const now = new Date();
    if (!user || user.status !== "ACTIVE" || (user.lockedUntil && user.lockedUntil > now)) {
      throw new AppError("用户名、密码或动态验证码不正确", "ADMIN_LOGIN_FAILED", 401);
    }
    const passwordOk = await verifyAdminPassword(user.passwordHash, request.body.password);
    let totpOk = false;
    if (passwordOk) {
      try { totpOk = verifyTotp(decryptAdminSecret(user.totpSecretEncrypted, config.adminEncryptionKey), request.body.totp); }
      catch { totpOk = false; }
    }
    if (!passwordOk || !totpOk) {
      await recordFailedAdminLogin(prisma, user.id, now);
      throw new AppError("用户名、密码或动态验证码不正确", "ADMIN_LOGIN_FAILED", 401);
    }
    const token = randomSessionToken();
    const csrfToken = randomSessionToken(32);
    const expiresAt = new Date(Date.now() + config.adminSessionTtlHours * 60 * 60_000);
    await prisma.$transaction([
      prisma.adminUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } }),
      prisma.adminSession.create({
        data: {
          adminUserId: user.id,
          tokenHash: sha256(token),
          csrfTokenHash: sha256(csrfToken),
          expiresAt,
          ipHash: sha256(`${config.adminEncryptionKey}:${request.ip}`),
          userAgent: String(request.headers["user-agent"] || "").slice(0, 255) || null
        }
      })
    ]);
    setSessionCookie(reply, config, token);
    return { data: { user: adminView(user), csrfToken, expiresAt: expiresAt.toISOString() } };
  });

  app.get("/api/v1/admin/auth/me", { preHandler: security.authenticate }, async (request) => ({
    data: { ...request.adminUser, user: request.adminUser, reviewPolicy: config.adminReviewPolicy }
  }));

  app.post("/api/v1/admin/auth/logout", { preHandler: security.authenticate }, async (request, reply) => {
    await prisma.adminSession.updateMany({ where: { id: request.adminUser!.sessionId }, data: { revokedAt: new Date() } });
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { data: { loggedOut: true } };
  });
}
