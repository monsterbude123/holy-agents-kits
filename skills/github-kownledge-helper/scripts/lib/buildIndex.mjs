// buildIndex.mjs — 触发 doc-map-manager 增量索引
//
// 设计要点：
//   - stdio 抓 stdout/stderr，逐行打印
//   - 区分 exit 0 / 非 0 / spawn ENOENT 三种情况
//   - 不 reject Promise（调用方 void 触发），但 stderr 必透传
//   - spawn 可注入（第三参数），便于单测断言调用参数而不 mock node:child_process

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { get } from './envStrict.mjs';

/**
 * 触发 doc-map-manager 增量索引（异步、不阻塞 add；失败必须可见）。
 */
export function runBuildIndex(
  scriptsDir = get('doc_map_scripts'),
  docsDir = get('docs_root'),
  spawnFn = spawn
) {
  const scriptPath = join(scriptsDir, 'build-index.py');
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(
        'python',
        [scriptPath, '--incremental', '--docs-dir', docsDir],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (e) {
      const msg = e.message;
      console.error(`[build-index/err] spawn failed: ${msg}`);
      resolve({ ok: false, code: -1, reason: 'spawn-failed', stderrTail: msg });
      return;
    }

    let stderrBuf = '';
    child.stderr?.on('data', (d) => {
      const s = d.toString('utf-8');
      stderrBuf += s;
      for (const line of s.split(/\r?\n/)) {
        if (line) console.error(`[build-index/err] ${line}`);
      }
    });
    child.stdout?.on('data', (d) => {
      for (const line of d.toString('utf-8').split(/\r?\n/)) {
        if (line) console.log(`[build-index] ${line}`);
      }
    });

    let spawnFailed = false;
    child.on('error', (e) => {
      spawnFailed = true;
      console.error(`[build-index/err] process error: ${e.message}`);
    });

    child.on('close', (code) => {
      const stderrTail = stderrBuf.trim().slice(-2000);
      if (code === 0) {
        console.log(`[build-index] done (exit 0)`);
        resolve({ ok: true, code, reason: 'success', stderrTail });
      } else if (spawnFailed) {
        resolve({ ok: false, code, reason: 'spawn-failed', stderrTail });
      } else {
        console.error(
          `[build-index/err] exit ${code} — 索引未完成，可手动跑: python ${scriptPath} --incremental`
        );
        resolve({ ok: false, code, reason: 'error', stderrTail });
      }
    });
  });
}
