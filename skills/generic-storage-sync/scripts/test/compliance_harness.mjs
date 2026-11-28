// compliance_harness.mjs — 第三方存储驱动合规验收套件（零依赖，仅 Node 内置模块）
// 用法：const r = await runDriverComplianceTests((opts) => new MyPanDriver(opts))。
// 只依赖驱动公开方法（ping/upload/download/exists/list/moveToTrash/readIndex/writeIndex/norm/joinPath/trashRoot），不 import 任何具体驱动实现 → 外部网盘驱动可直接复用；临时目录自建自清，绝不物理 unlink 被测文件。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const sha12 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const fail = (m) => { throw new Error(m); };
const expect = (c, m) => { if (!c) fail(m); };
const same = (v, t) => { try { assert.deepStrictEqual(v, t); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 逐字节比对；不一致时给出期望/实际/首个差异位 */
function assertBytes(actual, expected, what) {
  if (!actual.equals(expected)) {
    let diff = -1;
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) if (actual[i] !== expected[i]) { diff = i; break; }
    fail(`${what} 字节不一致: expected ${expected.length}B sha=${sha12(expected)}, actual ${actual.length}B sha=${sha12(actual)}, firstDiff=${diff}`);
  }
  return `${what} 一致 (${expected.length}B sha=${sha12(expected)})`;
}

/** 运行驱动合规验收（外部 Agent 一键验收入口）。driverFactory 接收 { root, ...options }；options.root 可指定外部介质根。 */
export async function runDriverComplianceTests(driverFactory, options = {}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'gss-harness-'));
  const externalRoot = options.root ?? null;
  const mediaRoot = externalRoot ?? join(tmpRoot, 'media');
  const localDir = join(tmpRoot, 'local');
  mkdirSync(localDir, { recursive: true });
  if (!externalRoot) mkdirSync(mediaRoot, { recursive: true });
  const mkSrc = (name, buf) => { const p = join(localDir, name); writeFileSync(p, buf); return p; };
  const dl = (name) => join(localDir, name);
  let driver = null;
  const results = [];
  const push = async (name, fn) => {
    try { results.push({ name, ok: true, message: `[${driver?.driverType || 'unknown'}] ${(await fn()) ?? 'ok'}` }); }
    catch (err) { results.push({ name, ok: false, message: `[${driver?.driverType || 'unknown'}] ${err?.message ?? String(err)}` }); }
  };
  try {
    expect(typeof driverFactory === 'function', 'driverFactory 必须是函数');
    driver = await driverFactory({ ...options, root: mediaRoot });
    await push('ping', async () => {
      const r = await driver.ping();
      expect(r, `ping() 必须返回真值，实际 ${JSON.stringify(r) ?? String(r)}`);
      return `ping ok: ${JSON.stringify(r)}`;
    });
    await push('upload-content-identical', async () => {
      const pay = Buffer.from('gss-A:' + 'a'.repeat(4096));
      await driver.upload(mkSrc('a.bin', pay), 'gss-a.bin');
      expect(await driver.exists('gss-a.bin'), '上传后目标文件不存在: gss-a.bin');
      await driver.download('gss-a.bin', dl('a.back'));
      return assertBytes(readFileSync(dl('a.back')), pay, '上传后回读');
    });
    await push('upload-overwrite', async () => {
      const pay = Buffer.from('gss-B:' + 'b'.repeat(64)); // 比 A 短：易暴露拼接残留
      await driver.upload(mkSrc('b.bin', pay), 'gss-a.bin');
      await driver.download('gss-a.bin', dl('b.back'));
      return assertBytes(readFileSync(dl('b.back')), pay, '同名二次上传后');
    });
    await push('moveToTrash-soft-delete', async () => {
      const pay = Buffer.from('gss-T:' + 't'.repeat(512));
      await driver.upload(mkSrc('t.bin', pay), 'gss-t.bin');
      const r = await driver.moveToTrash('gss-t.bin');
      expect(!(await driver.exists('gss-t.bin')), `moveToTrash 后源路径仍存在: gss-t.bin (result=${JSON.stringify(r)})`);
      const trashRoot = typeof driver.trashRoot === 'string' && driver.trashRoot ? driver.trashRoot : '.trash';
      let entries;
      try { entries = await driver.list(trashRoot); } catch (err) { fail(`回收站不可列举 (trashRoot=${trashRoot}): ${err?.message ?? err}`); }
      const hit = (entries || []).find((e) => String(e?.name || '').includes('gss-t.bin'));
      expect(hit, `回收站内找不到被淘汰文件: trashRoot=${trashRoot}, entries=${JSON.stringify((entries || []).map((e) => e?.name))}`);
      const remote = hit.path || (typeof driver.joinPath === 'function' ? driver.joinPath(trashRoot, hit.name) : hit.name);
      await driver.download(remote, dl('t.back'));
      return `${assertBytes(readFileSync(dl('t.back')), pay, '回收站副本')}；已软删除: ${remote}`;
    });
    await push('index-roundtrip', async () => {
      const idx = { version: 1, snapshots: [{ fullName: 'o/r', commitSha: 'abc123', tags: ['v1'] }] };
      await driver.writeIndex(idx);
      const back = await driver.readIndex();
      expect(back !== null && back !== undefined, 'writeIndex 后 readIndex() 返回空');
      assert.deepStrictEqual(back, idx);
      return 'writeIndex → readIndex 往返一致';
    });
    await push('index-atomic-write', async () => {
      const v1 = { version: 1, snapshots: [{ fullName: 'o/r', commitSha: 'v1' }] };
      const v2 = { version: 2, pad: 'x'.repeat(128 * 1024), snapshots: [{ fullName: 'o/r', commitSha: 'v2' }] };
      await driver.writeIndex(v1);
      let stop = false; const seen = [];
      const poller = (async () => {
        while (!stop) {
          try { seen.push({ ok: true, value: await driver.readIndex() }); }
          catch (err) { seen.push({ ok: false, error: String(err?.message ?? err) }); }
          await sleep(1);
        }
      })();
      await driver.writeIndex(v2);
      stop = true;
      await poller;
      const bad = seen.filter((s) => !s.ok || !(same(s.value, v1) || same(s.value, v2)));
      expect(bad.length === 0, `写入期间读到半写/损坏索引 ${bad.length}/${seen.length} 次，首例: ${JSON.stringify(bad[0])}`);
      assert.deepStrictEqual(await driver.readIndex(), v2);
      const residue = (await driver.list(mediaRoot)).map((e) => e?.name).filter((n) => /\.tmp$/i.test(String(n)));
      expect(residue.length === 0, `索引写入后残留临时文件: ${residue.join(', ')}`);
      return `原子写通过（并发观测 ${seen.length} 次，未见半写）`;
    });
    await push('upload-progress-monotonic', async () => {
      const pay = Buffer.alloc(512 * 1024, 7);
      const calls = [];
      await driver.upload(mkSrc('p.bin', pay), 'gss-p.bin', { onProgress: (t, n) => calls.push([t, n]) });
      expect(calls.length >= 1, 'onProgress 未被触发');
      for (let i = 1; i < calls.length; i++) expect(Number(calls[i][0]) >= Number(calls[i - 1][0]), `进度回退: 第 ${i} 次 ${calls[i - 1][0]} → ${calls[i][0]}`);
      const last = calls[calls.length - 1];
      expect(Number(last[0]) === pay.length, `进度终值不等于总字节: expected ${pay.length}, actual ${last[0]}`);
      if (typeof last[1] === 'number') expect(last[1] === pay.length, `progress total 不等于总字节: expected ${pay.length}, actual ${last[1]}`);
      return `onProgress 触发 ${calls.length} 次，终值 ${last[0]}/${last[1]}`;
    });
    await push('upload-abort-signal', async () => {
      const src = mkSrc('abort.bin', Buffer.alloc(1024, 7)); const ac = new AbortController(); ac.abort();
      let err = null;
      try { await driver.upload(src, 'gss-abort.bin', { signal: ac.signal }); } catch (e) { err = e; }
      expect(err, '传入已 abort 的 signal 时 upload() 未抛异常（静默成功）');
      expect(err.name === 'AbortError' || err.code === undefined || err.code === 'GSS_E_ABORTED', `中断错误码不合法: expected GSS_E_ABORTED, actual code=${err.code} name=${err.name}`);
      expect(!(await driver.exists('gss-abort.bin')), '中断后目标文件仍落地: gss-abort.bin');
      return `已 abort 的 signal 正确抛错 (code=${err.code ?? err.name})`;
    });
    await push('unc-path-normalization', async () => {
      expect(typeof driver.norm === 'function' || typeof driver.joinPath === 'function', '驱动缺少公开路径规整方法 norm()/joinPath()');
      const j = typeof driver.joinPath === 'function' ? String(driver.joinPath('//nas/share', 'snap.bundle')) : '';
      if (j) expect(j.startsWith('//'), `joinPath 压掉 UNC 双斜杠前缀: //nas/share + snap.bundle → ${j}`);
      for (const p of typeof driver.norm === 'function' ? ['//host/share', '\\\\host\\share'] : []) {
        const out = String(driver.norm(p));
        expect(out.startsWith('//'), `UNC 前缀被压成单斜杠: ${p} → ${out}`);
      }
      return 'UNC 双斜杠前缀保留';
    });
  } catch (err) {
    results.push({ name: 'driver-factory', ok: false, message: `[unknown] ${err?.message ?? String(err)}` });
  } finally {
    // 外部介质根：只软删除本次落地的测试文件，绝不物理 unlink
    for (const n of externalRoot && driver ? ['gss-a.bin', 'gss-t.bin', 'gss-p.bin', 'gss-abort.bin'] : []) {
      try { await driver.moveToTrash(n); } catch { /* 软删除失败不影响验收结论 */ }
    }
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, total: results.length, driverType: driver?.driverType || 'unknown', results };
}
