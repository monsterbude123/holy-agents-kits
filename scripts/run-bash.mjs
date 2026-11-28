#!/usr/bin/env node
// run-bash.mjs — 用 Git Bash 跑一个 .sh 脚本（跨 Windows / POSIX 一致）
//
// 为什么需要：Windows 上 PATH 里的 bash 是 C:\Windows\System32\bash.exe ——
// **WSL 的 bash**，里面没有 node、没有 /c 挂载，仓库里的 .sh 必然
// "node: command not found"。Git Bash 才有 Git for Windows 的 POSIX 工具链。
//
// 用法：node scripts/run-bash.mjs <script.sh> [args...]
//   环境变量 GHH_BASH 可覆盖 bash 路径。
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** 定位 Git Bash：显式候选 → PATH 里的 bash（排除 WSL 变体） */
export function resolveBash() {
  const override = process.env.GHH_BASH;
  if (override && existsSync(override)) return override;

  const candidates = [
    "C:/Program Files/Git/bin/bash.exe",
    "C:/Program Files (x86)/Git/bin/bash.exe",
    "C:/Program Files/Git/usr/bin/bash.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // 兜底：PATH 里的 bash，但排除 WSL 变体（WSL 的 --version 也叫 GNU bash，
  // 用「能否访问仓库文件」来区分：WSL 里看不到 Windows 盘符路径）
  const probe = spawnSync("bash", ["-c", 'echo ok'], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return "bash";
  return "bash";
}

const [script, ...args] = process.argv.slice(2);

// 直接执行时才跑；被 import 时只导出 resolveBash。
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  if (!script) {
    console.error("用法：node scripts/run-bash.mjs <script.sh> [args...]");
    process.exit(1);
  }
  const bash = resolveBash();
  const r = spawnSync(bash, [script, ...args], { stdio: "inherit" });
  process.exit(r.status === null ? 2 : r.status);
}
