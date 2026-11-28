// addBatch.test.mjs — add-batch 批量收录命令测试（node:test）
//
// 存在的理由：单仓 add 遇到大仓/慢速网络时必须逐个手动重跑，
// 且失败后无法续跑。这里锁定批量语义：
//   · 顺序执行（rules.md §4.3：禁止并发打满网络）
//   · 断点续跑：已收录的跳过，残缺目录清理后重试
//   · 单个失败不中断整批，最后汇总报告
//   · 结束时收口 manifest（唯一事实源）

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAddBatch } from '../commands/add-batch.mjs';

describe('add-batch', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-batch-'));
    mkdirSync(join(tmpRoot, 'repos'), { recursive: true });
    mkdirSync(join(tmpRoot, 'docs'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'manifest.json'),
      JSON.stringify(
        { version: '1.1', updated_at: '2026-08-13T12:00:00+08:00', repo_count: 0, repos: [] },
        null,
        2
      )
    );
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('空列表直接返回空报告，不报错', async () => {
    const report = await runAddBatch({ repos: [], cwd: tmpRoot });
    assert.equal(report.total, 0);
    assert.deepEqual(report.results, []);
  });

  it('逐个顺序调用 add（不并发），并汇总结果', async () => {
    const calls = [];
    const report = await runAddBatch({
      repos: ['a/one', 'b/two', 'c/three'],
      cwd: tmpRoot,
      addOne: async (full) => {
        calls.push(full);
        return { ok: full !== 'b/two', message: `mock ${full}` };
      },
    });
    assert.deepEqual(calls, ['a/one', 'b/two', 'c/three'], '必须按输入顺序调用');
    assert.equal(report.total, 3);
    assert.equal(report.okCount, 2, '两个成功');
    assert.equal(report.failCount, 1, '一个失败');
    assert.equal(report.results[1].repo, 'b/two');
    assert.equal(report.results[1].status, 'error');
  });

  it('单个仓失败不中断整批', async () => {
    const calls = [];
    const report = await runAddBatch({
      repos: ['a/one', 'b/two', 'c/three'],
      cwd: tmpRoot,
      addOne: async (full) => {
        calls.push(full);
        if (full === 'a/one') throw new Error('boom');
        return { ok: true, message: 'ok' };
      },
    });
    assert.deepEqual(calls, ['a/one', 'b/two', 'c/three'], '失败后仍继续后续仓');
    assert.equal(report.failCount, 1);
    assert.equal(report.results[0].status, 'error');
    assert.ok(report.results[0].message.includes('boom'), '错误信息要带出来');
  });

  it('已收录的仓被跳过，不重复 clone', async () => {
    const calls = [];
    const report = await runAddBatch({
      repos: ['a/one', 'a/one'],
      cwd: tmpRoot,
      isAlreadyCollected: (full) => full === 'a/one',
      addOne: async (full) => {
        calls.push(full);
        return { ok: true };
      },
    });
    assert.deepEqual(calls, [], '已收录的不该再 clone');
    // 输入去重后只剩 1 个仓（同一个仓不该收录两次）
    assert.equal(report.total, 1);
    assert.equal(report.skippedCount, 1);
    assert.equal(report.results[0].status, 'skipped');
  });

  it('输入里的重复项只处理一次', async () => {
    const calls = [];
    await runAddBatch({
      repos: ['a/one', 'a/one', 'a/one'],
      cwd: tmpRoot,
      addOne: async (full) => {
        calls.push(full);
        return { ok: true };
      },
    });
    assert.deepEqual(calls, ['a/one'], '重复项应去重');
  });

  it('结束时收口 manifest（唯一事实源）', async () => {
    const calls = [];
    await runAddBatch({
      repos: ['a/one'],
      cwd: tmpRoot,
      addOne: async () => ({ ok: true }),
      finalize: async () => {
        calls.push('finalize');
      },
    });
    assert.deepEqual(calls, ['finalize'], '必须收口 manifest');
  });

  it('即使有失败也要收口 manifest', async () => {
    const calls = [];
    await runAddBatch({
      repos: ['a/one'],
      cwd: tmpRoot,
      addOne: async () => ({ ok: false, message: 'nope' }),
      finalize: async () => {
        calls.push('finalize');
      },
    });
    assert.deepEqual(calls, ['finalize']);
  });
});
