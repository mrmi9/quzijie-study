import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

export interface WechatIdentity {
  openId: string;
  unionId?: string;
}

export interface WechatAuthProvider {
  exchangeCode(code: string): Promise<WechatIdentity>;
}

class StubWechatAuthProvider implements WechatAuthProvider {
  constructor(private readonly openId: string) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    if (!code.trim()) throw new AppError("微信登录凭证不能为空", "VALIDATION_ERROR", 400);
    return { openId: this.openId };
  }
}

class RealWechatAuthProvider implements WechatAuthProvider {
  constructor(private readonly appId: string, private readonly appSecret: string) {}

  async exchangeCode(code: string): Promise<WechatIdentity> {
    if (!code.trim()) throw new AppError("微信登录凭证不能为空", "VALIDATION_ERROR", 400);
    const query = new URLSearchParams({
      appid: this.appId,
      secret: this.appSecret,
      js_code: code,
      grant_type: "authorization_code"
    });
    let response: Response;
    try {
      response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, {
        signal: AbortSignal.timeout(5000)
      });
    } catch (error) {
      throw new AppError("微信登录服务暂时不可用", "WECHAT_SERVICE_UNAVAILABLE", 503, String(error));
    }
    const payload = await response.json() as { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    if (!response.ok || payload.errcode || !payload.openid) {
      throw new AppError("微信登录凭证无效", "WECHAT_LOGIN_FAILED", 401, {
        errcode: payload.errcode,
        errmsg: payload.errmsg
      });
    }
    return { openId: payload.openid, unionId: payload.unionid };
  }
}

export function createWechatAuthProvider(config: AppConfig): WechatAuthProvider {
  return config.wechatAuthMode === "real"
    ? new RealWechatAuthProvider(config.wechatAppId, config.wechatAppSecret)
    : new StubWechatAuthProvider(config.wechatDevOpenId);
}
