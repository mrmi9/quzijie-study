import { randomBytes } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { sha256 } from "../auth/admin.js";
import { requireInteractiveSecretTerminal } from "./admin-cli-security.js";

requireInteractiveSecretTerminal("bootstrap-token", input, output);
const token = randomBytes(32).toString("base64url");

process.stdout.write([
  "一次性后台初始化令牌（仅显示本次，请安全保存）：",
  token,
  "",
  `ADMIN_BOOTSTRAP_TOKEN_HASH=${sha256(token)}`,
  "",
  "只把 SHA-256 配置到云环境；不要把原令牌写入代码、日志或截图。",
  ""
].join("\n"));
