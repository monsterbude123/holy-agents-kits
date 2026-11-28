// updateLog.mjs — update / update-all 的阶段日志（纯输出，无业务逻辑）

const PROGRESS_BAR_RE = /^[\s]*[\w-]+:.*\d+\%/; // 过滤 git 内置进度条

const PAD = 50;

/** 长过程日志：开始 */
export function logStart(idx, total, repo, before) {
  const prefix = `[${String(idx).padStart(2)}/${total}]`;
  console.log(
    `${prefix} ▶ ${repo.full_name.padEnd(PAD)} (HEAD=${before})`
  );
}

/** 长过程日志：结果 */
export function logResult(idx, total, r) {
  const prefix = `[${String(idx).padStart(2)}/${total}]`;
  if (r.ok && r.changed) {
    console.log(
      `${prefix}   ✓ ${r.repo.full_name.padEnd(PAD - 2)} ${r.before} -> ${r.after}`
    );
  } else if (r.ok) {
    console.log(
      `${prefix}   · ${r.repo.full_name.padEnd(PAD - 2)} up to date (${r.after})`
    );
  } else {
    console.log(
      `${prefix}   ✗ ${r.repo.full_name.padEnd(PAD - 2)} ${r.message}`
    );
  }
}

/** 判断一行是否 git 进度条（'remote: Enumerating objects: 12%'） */
export function isProgressBar(line) {
  return (
    PROGRESS_BAR_RE.test(line) ||
    /^\s*Receiving objects:/.test(line) ||
    /^\s*Resolving deltas:/.test(line)
  );
}
