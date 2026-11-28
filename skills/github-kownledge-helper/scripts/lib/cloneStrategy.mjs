// cloneStrategy.mjs — clone 策略：超时可配 + 失败降级浅克隆 + 失败必清理
//
// 存在的理由（真实事故倒逼）：
//   · 大仓在慢速网络下完整 clone 会超时 —— 超时值必须是可配的，不能写死 10 分钟
//   · 超时/失败后不能留半成品目录 —— git clone 失败会自己删目录，但被杀时不一定
//   · references/rules.md §4.5 承诺「连续失败可降级为浅克隆重试」，这里落地该承诺
//
// 约束：
//   · 浅克隆用 --depth 1 + --single-branch：只要默认分支的完整工作树，
//     不拉 4 万+ PR ref（那才是完整 clone 体积爆炸的真正原因）

import { rmSync } from 'node:fs';

/** 浅克隆深度：1 —— 归档只需要默认分支的完整工作树 */
export const SHALLOW_DEPTH = 1;

/** 默认 clone 超时：60 分钟（可由调用方覆盖） */
export const DEFAULT_CLONE_TIMEOUT_MS = 60 * 60_000;

/**
 * 生成 clone 的尝试序列。
 * @param {object} opts
 * @param {boolean} [opts.allowShallow=true]  是否允许降级为浅克隆
 * @param {boolean} [opts.shallowFirst=false] 是否直接先试浅克隆（网络极差场景）
 * @returns {Array<{args: string[], shallow: boolean}>}
 */
export function resolveCloneAttempts(opts = {}) {
  const { allowShallow = true, shallowFirst = false } = opts;
  const full = { args: ['--single-branch'], shallow: false };
  const shallow = { args: ['--depth', String(SHALLOW_DEPTH), '--single-branch'], shallow: true };

  if (!allowShallow) return [full];
  if (shallowFirst) return [shallow, full];
  return [full, shallow];
}

/**
 * 执行 clone，失败时按 attempts 序列重试（完整 → 浅克隆）。
 *
 * @param {object} opts
 * @param {string} opts.url        clone 地址
 * @param {string} opts.target     目标目录
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.allowShallow]
 * @param {boolean} [opts.shallowFirst]
 * @param {(args: string[], target: string) => Promise<{ok: boolean, code?: number, exitReason?: string, stderr?: string}>} opts.run
 *        实际执行 clone 的函数（注入以便测试，不碰真实网络）
 * @returns {Promise<{ok: boolean, attempts: number, usedShallow: boolean, message?: string, code?: number}>}
 */
export async function cloneWithFallback(opts) {
  const {
    url,
    target,
    timeoutMs = DEFAULT_CLONE_TIMEOUT_MS,
    allowShallow = true,
    shallowFirst = false,
    run,
  } = opts;

  const attempts = resolveCloneAttempts({ allowShallow, shallowFirst });
  let last = { ok: false, code: -1, exitReason: 'unknown', stderr: '' };

  for (const attempt of attempts) {
    const res = await run(attempt.args, target);
    last = res;
    if (res.ok) {
      return {
        ok: true,
        attempts: attempts.indexOf(attempt) + 1,
        usedShallow: attempt.shallow,
        code: res.code ?? 0,
      };
    }
    // 失败后清掉半成品目录，否则下一次 clone 到已存在的非空目录会直接失败
    cleanupPartialClone(target);
  }

  return {
    ok: false,
    attempts: attempts.length,
    usedShallow: false,
    code: last.code ?? -1,
    message:
      `clone failed after ${attempts.length} attempt(s) ` +
      `(last exitReason=${last.exitReason ?? 'error'}, code=${last.code ?? -1})` +
      (last.stderr ? `: ${String(last.stderr).slice(-300)}` : ''),
  };
}

/**
 * 清掉克隆失败留下的半成品目录。
 * 只删 target 自身，不碰父目录。
 */
export function cleanupPartialClone(target) {
  if (!target) return;
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    /* Windows 上 git 可能短暂持句柄；下次 clone 前会再判一次 */
  }
}
