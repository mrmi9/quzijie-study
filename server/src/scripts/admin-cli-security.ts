export interface TtyStream {
  readonly isTTY?: boolean;
}

/** Commands that emit a newly generated authentication secret must never run
 * with piped input or redirected output, otherwise the secret can leak into
 * shell history, CI logs or files. */
export function requireInteractiveSecretTerminal(command: string, input: TtyStream, output: TtyStream): void {
  if (!["create", "reset-totp", "bootstrap-token"].includes(command)) return;
  if (!input.isTTY || !output.isTTY) {
    throw new Error("生成管理凭据只能在真实交互终端中执行，禁止管道输入或重定向输出密钥");
  }
}
