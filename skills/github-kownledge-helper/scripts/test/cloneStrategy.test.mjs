// cloneStrategy.test.mjs — clone 策略（超时/降级/进程树）单元测试（node:test）
//
// 背景（真实事故）：
//   1. add.mjs 把 clone 超时硬编码 10 分钟，大仓（orca 3.7GB / 1MB/s 带宽）必然超时。
//   2. git.mjs 超时只 kill 直接子进程，不杀进程树 → git clone 变成孤儿继续跑，
//      父进程已死，后续步骤（写 manifest）不执行，且 clone 失败时 git 会清理目标目录，
//      已下载的数据全部丢失。
//   3. references/rules.md §4.5 承诺「连续失败 2 次可降级为浅克隆重试」，
//      但代码里没有任何 --depth 实现 → 规则与实现脱节。
//
// 本测试锁定：超时可配、失败降级、失败必清理半成品目录（不静默残留）。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cloneWithFallback,
  resolveCloneAttempts,
  cleanupPartialClone,
  DEFAULT_CLONE_TIMEOUT_MS,
  SHALLOW_DEPTH,
} from '../lib/cloneStrategy.mjs';

describe('clone 策略', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ghh-clone-'));
    mkdirSync(join(tmpRoot, 'repos'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* Windows 上 git 可能短暂持句柄，忽略 */
    }
  });

  describe('resolveCloneAttempts', () => {
    it('默认先完整克隆，失败后降级浅克隆', () => {
      const attempts = resolveCloneAttempts({});
      assert.equal(attempts.length, 2, '应有完整 + 浅克隆两次尝试');
      assert.equal(attempts[0].args.includes('--depth'), false, '第一次必须是完整克隆');
      assert.equal(attempts[1].args.includes('--depth'), true, '第二次必须降级为浅克隆');
      assert.equal(attempts[1].args[attempts[1].args.indexOf('--depth') + 1], String(SHALLOW_DEPTH));
    });

    it('allowShallow=false 时只尝试完整克隆一次', () => {
      const attempts = resolveCloneAttempts({ allowShallow: false });
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].args.includes('--depth'), false);
    });

    it('shallowFirst=true 时直接浅克隆（网络极差场景）', () => {
      const attempts = resolveCloneAttempts({ shallowFirst: true });
      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].args.includes('--depth'), true, '浅克隆应排第一');
      assert.equal(attempts[1].args.includes('--depth'), false);
    });

    it('每次尝试都带 --single-branch，避免拉全部 PR ref', () => {
      for (const a of resolveCloneAttempts({})) {
        assert.equal(a.args.includes('--single-branch'), true, '每次尝试都要 --single-branch');
      }
    });
  });

  describe('cloneWithFallback', () => {
    it('完整克隆成功时不再尝试浅克隆', async () => {
      const calls = [];
      const res = await cloneWithFallback({
        url: 'https://example.invalid/x.git',
        target: join(tmpRoot, 'repos', 'x__y'),
        timeoutMs: 1000,
        run: async (args) => {
          calls.push(args);
          return { ok: true, code: 0 };
        },
      });
      assert.equal(res.ok, true);
      assert.equal(calls.length, 1, '成功时只跑一次');
      assert.equal(res.usedShallow, false);
    });

    it('完整克隆失败后自动降级浅克隆并成功', async () => {
      const calls = [];
      const res = await cloneWithFallback({
        url: 'https://example.invalid/x.git',
        target: join(tmpRoot, 'repos', 'x__y'),
        timeoutMs: 1000,
        run: async (args) => {
          calls.push(args);
          // 第一次（完整克隆）失败，第二次（浅克隆）成功
          return calls.length === 1
            ? { ok: false, code: 128 }
            : { ok: true, code: 0 };
        },
      });
      assert.equal(res.ok, true);
      assert.equal(calls.length, 2, '应重试一次');
      assert.equal(res.usedShallow, true, '应标记走了浅克隆降级');
    });

    it('两次都失败时返回失败并保留最后一次错误', async () => {
      const res = await cloneWithFallback({
        url: 'https://example.invalid/x.git',
        target: join(tmpRoot, 'repos', 'x__y'),
        timeoutMs: 1000,
        run: async () => ({ ok: false, code: 128 }),
      });
      assert.equal(res.ok, false);
      assert.equal(res.attempts, 2);
      assert.ok(res.message, '失败必须带错误信息，不静默');
    });

    it('allowShallow=false 时失败不重试', async () => {
      let n = 0;
      const res = await cloneWithFallback({
        url: 'https://example.invalid/x.git',
        target: join(tmpRoot, 'repos', 'x__y'),
        timeoutMs: 1000,
        allowShallow: false,
        run: async () => {
          n++;
          return { ok: false, code: 128 };
        },
      });
      assert.equal(res.ok, false);
      assert.equal(n, 1, '禁用降级时只尝试一次');
    });
  });

  describe('cleanupPartialClone', () => {
    it('失败后清掉半成品目录，不留残缺仓', () => {
      const target = join(tmpRoot, 'repos', 'x__y');
      mkdirSync(join(target, '.git'), { recursive: true });
      writeFileSync(join(target, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      assert.equal(existsSync(target), true);
      cleanupPartialClone(target);
      assert.equal(existsSync(target), false, '残缺目录必须清掉');
    });

    it('目录不存在时不报错', () => {
      cleanupPartialClone(join(tmpRoot, 'repos', 'nope'));
    });
  });

  describe('默认超时', () => {
    it('默认超时不再是 10 分钟硬编码（应足够容纳大仓）', () => {
      assert.ok(
        DEFAULT_CLONE_TIMEOUT_MS > 10 * 60_000,
        `默认超时 ${DEFAULT_CLONE_TIMEOUT_MS}ms 应大于 10 分钟`,
      );
    });
  });
});
