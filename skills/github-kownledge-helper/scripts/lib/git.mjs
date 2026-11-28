// git.mjs — git 命令封装
// 用 child_process 调用系统 git，避免引入 isomorphic-git 等重型依赖
// 三套 API：
//   - git(cwd, args)                 读操作：失败返回空字符串
//   - gitRun(cwd, args)              写操作（批式）：返回 {ok, stdout, stderr, code}
//   - gitStream(cwd, args, onLine)   写操作（流式）：stdout/stderr 逐行回调，适合长过程
//                                      返回 {ok, code, exitReason}，exitReason: 'success' | 'error' | 'timeout' | 'spawn-failed'

import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/** 读操作：成功返回 stdout，失败返回空字符串 */
export function git(cwd, args) {
  const r = gitRun(cwd, args);
  return r.ok ? r.stdout : '';
}

/** 批式写操作：等待完成返回完整结果。用于短命令。 */
export function gitRun(cwd, args) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (e) {
    const err = e;
    return {
      ok: false,
      stdout: err.stdout ? err.stdout.toString().trim() : '',
      stderr: err.stderr ? err.stderr.toString().trim() : '',
      code: err.status ?? 1,
    };
  }
}

/**
 * 流式执行 git 命令，逐行转发 stdout/stderr 到 console（带 [label] 前缀）。
 * 长过程命令（fetch / pull / clone）必须用此函数，否则用户视角会「卡死」。
 *
 * @param onLine 每行回调（line 含 \r 已被规范化为 \n）
 */
export function gitStream(cwd, args, onLine, options = {}) {
  const { label = 'git', silent = false, timeoutMs = 5 * 60_000 } = options;
  const tag = `[${label}]`;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      // spawn 本身失败（如 ENOENT）
      onLine(`spawn failed: ${e.message}`, 'stderr');
      resolve({ ok: false, code: -1, exitReason: 'spawn-failed' });
      return;
    }

    // 用 \n 切行并规范化（git 在 Windows 下偶发 \r\n）
    const makeHandler = (stream) => {
      const decoder = new StringDecoder('utf-8');
      let buf = '';
      return (chunk) => {
        buf += decoder.write(chunk);
        // 兼容 \r\n 和 \r（git progress 偶尔用 \r 覆盖行）
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          onLine(line, stream);
        }
      };
    };

    child.stdout.on('data', makeHandler('stdout'));
    child.stderr.on('data', makeHandler('stderr'));

    child.on('error', (e) => {
      onLine(`process error: ${e.message}`, 'stderr');
      resolve({ ok: false, code: -1, exitReason: 'spawn-failed' });
    });

    // 超时控制
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            onLine(`TIMEOUT after ${timeoutMs}ms, killing...`, 'stderr');
            child.kill('SIGTERM');
            // 5s 后仍未退，强杀
            setTimeout(() => child.kill('SIGKILL'), 5_000);
          }, timeoutMs)
        : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (silent) {
        // 末尾 line 一般是空（split 后空字符串），不输出避免污染
      }
      if (timedOut) {
        resolve({ ok: false, code: code ?? -1, exitReason: 'timeout' });
      } else if (code === 0) {
        resolve({ ok: true, code: 0, exitReason: 'success' });
      } else {
        resolve({ ok: false, code: code ?? -1, exitReason: 'error' });
      }
    });
  });
}
