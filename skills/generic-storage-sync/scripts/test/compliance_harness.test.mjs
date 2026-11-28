// compliance_harness.test.mjs — 对合规套件本身做单测：结构契约 + 双向有效性
// 只依赖驱动的公开契约：合规驱动全过、违规驱动被抓出、结果对象计数与字段正确。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { LocalFsDriver } from '../local_driver.mjs';
import { runDriverComplianceTests } from './compliance_harness.mjs';

const REQUIRED_ITEMS = [
  'ping', 'upload-content-identical', 'upload-overwrite', 'moveToTrash-soft-delete',
  'index-roundtrip', 'index-atomic-write', 'upload-progress-monotonic',
  'upload-abort-signal', 'unc-path-normalization',
];

/**
 * 违规画像二：索引非原子写——直接写目标文件且中途留半截 JSON（不 .tmp + rename）。
 * 并发读者会读到解析失败的坏 JSON，必须被套件的原子性断言抓出。
 */
class NonAtomicIndexDriver extends LocalFsDriver {
  get driverType() { return 'non-atomic-index'; }

  async _writeIndex(content) {
    const p = this.indexPath();
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const half = Math.floor(text.length / 2);
    await writeFile(p, text.slice(0, half), 'utf-8');
    await new Promise((r) => setTimeout(r, 80)); // 半写窗口：并发读者会看到坏 JSON
    await appendFile(p, text.slice(half), 'utf-8');
    return { path: p, bytes: Buffer.byteLength(text) };
  }
}

describe('合规套件自身', () => {
  it('合规驱动全过，且结果对象结构正确', async () => {
    const r = await runDriverComplianceTests((opts) => new LocalFsDriver(opts));
    const failed = r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.message}`);
    assert.deepEqual(failed, [], `合规驱动存在失败项:\n${failed.join('\n')}`);
    assert.equal(r.failed, 0);
    assert.equal(r.passed, r.total);
    assert.equal(r.total, r.results.length);
    assert.equal(typeof r.driverType, 'string');
    for (const item of r.results) {
      assert.equal(typeof item.name, 'string');
      assert.ok(item.name.length > 0, '断言项必须有 name');
      assert.equal(typeof item.ok, 'boolean');
      assert.equal(typeof item.message, 'string');
      assert.ok(item.message.length > 0, `断言项 ${item.name} 缺少 message`);
    }
    const names = r.results.map((x) => x.name);
    for (const must of REQUIRED_ITEMS) assert.ok(names.includes(must), `缺少断言项: ${must}`);
  });

  it('违规驱动被检出（索引非原子写 → 半写 JSON）', async () => {
    const r = await runDriverComplianceTests((opts) => new NonAtomicIndexDriver(opts));
    assert.ok(r.failed >= 1, '套件未能抓出违规驱动（疑似空壳）');
    const failed = r.results.filter((x) => !x.ok);
    assert.ok(failed.some((x) => x.name === 'index-atomic-write'),
      `未抓出非原子索引写: ${JSON.stringify(r.results, null, 2)}`);
    assert.ok(failed.every((x) => x.message.length > 0), '失败项必须带可定位诊断');
  });

  it('driverFactory 非法时返回结构化失败而非抛异常', async () => {
    const r = await runDriverComplianceTests(null);
    assert.equal(r.passed, 0);
    assert.ok(r.failed >= 1);
    assert.equal(r.results[0].name, 'driver-factory');
    assert.ok(r.results[0].message.includes('driverFactory'));
  });
});
