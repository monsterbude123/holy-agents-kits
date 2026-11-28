// mirror.mjs — 镜像仓库到任意绝对路径（跨平台）
//
// 协议（见 references/workflows-sync-to.md）：
//   - git 无原生本地 fork 命令 → 直接复制含 .git 的整目录
//   - 跨平台：用 fs.cpSync（recursive + 含隐藏文件），避免依赖 robocopy
//   - 目标已存在 → 报错停手（不覆盖）
//   - 不写 manifest，不触发 doc-map-manager 索引（镜像 ≠ 收录）

import { cpSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { git } from './git.mjs';

/**
 * 镜像仓库到指定绝对路径。
 * 失败时不抛错（除编程错误），通过 ok=false + message 反馈。
 */
export async function syncTo(opts) {
  const src = resolvePath(opts.sourcePath);
  const dst = resolvePath(opts.destination);

  // 1. 源必须存在
  if (!existsSync(src)) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `源目录不存在：${src}`,
    };
  }

  // 2. 源必须含 .git（git 仓库落地物）
  if (!existsSync(join(src, '.git'))) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `源目录不是 git 仓库（缺 .git）：${src}`,
    };
  }

  // 3. 目标已存在 → 报错停手
  if (existsSync(dst)) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `目标已存在，不覆盖：${dst}`,
    };
  }

  // 4. 读取源 sha（用于回执验证）
  const srcSha = git(src, ['rev-parse', 'HEAD']);
  if (!srcSha) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `源仓库 HEAD 读取失败：${src}`,
    };
  }

  // 5. 复制（fs.cpSync 跨平台，支持隐藏文件 + verbatim 符号链接）
  try {
    cpSync(src, dst, {
      recursive: true,
      verbatimSymlinks: true,
      dereference: false,
      // filter 跳过 pack 临时文件（git fetch 时的 tmp_*.pack 可能存在）
      filter: (p) => {
        const base = p.split(/[\\/]/).pop() ?? '';
        if (/^tmp_.*\.pack$/.test(base)) return false;
        if (base === '.lock') return false;
        return true;
      },
    });
  } catch (e) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `复制失败：${e.message}`,
    };
  }

  // 6. 验证 sha（防御性：复制后 .git 仍可用）
  const dstSha = git(dst, ['rev-parse', 'HEAD']);
  if (dstSha !== srcSha) {
    return {
      ok: false,
      source: src,
      destination: dst,
      message: `复制后 sha 校验失败：src=${srcSha} dst=${dstSha}`,
    };
  }

  return {
    ok: true,
    source: src,
    destination: dst,
    commitSha: srcSha,
    message: `✓ ${opts.repoInput} → ${dst} (${srcSha.slice(0, 7)})`,
  };
}
