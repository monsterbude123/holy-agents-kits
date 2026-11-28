// local_driver_compliance.test.mjs — LocalFsDriver 作为参考基准实现的合规验收（TKT-08）
// 含反向自检：一个故意违规的假驱动必须被套件抓出来，证明套件不是「永远通过」的空壳。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { LocalFsDriver } from '../local_driver.mjs';
import { runDriverComplianceTests } from './compliance_harness.mjs';

/**
 * 故意违规的假驱动（继承参考实现，只覆写三处「反模式」）：
 *  1. 覆写公共 upload() 绕过基类中断检查 + 丢弃 signal（忽略 AbortSignal）
 *  2. 上传过程从不触发 onProgress
 *  3. 淘汰直接物理 unlink，而不是移入 .trash/（防灾红线违规）
 */
class CheatingDriver extends LocalFsDriver {
  get driverType() { return 'cheating'; }

  async upload(localSrc, remoteDst, options = {}) { // 违规：覆写公共方法，绕过 throwIfAborted
    return this._upload(this.norm(localSrc), this.norm(remoteDst), options);
  }

  async _upload(localSrc, remoteDst, options = {}) {
    const { signal, ...rest } = options; // 违规：丢弃 AbortSignal
    return super._upload(localSrc, remoteDst, { ...rest, onProgress: undefined }); // 违规：不触发进度回调
  }

  async _moveToTrash(remotePath) { // 违规：物理删除代替软删除
    const p = this.resolveTarget(remotePath);
    await rm(p, { force: true });
    return { from: p, to: p, mode: 'unlink' };
  }
}

describe('LocalFsDriver 合规验收（TKT-08）', () => {
  it('参考基准实现通过率 100%', async () => {
    const r = await runDriverComplianceTests((opts) => new LocalFsDriver(opts));
    const failed = r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.message}`);
    assert.deepEqual(failed, [], `LocalFsDriver 存在不合规项:\n${failed.join('\n')}`);
    assert.equal(r.failed, 0);
    assert.equal(r.passed, r.total);
    assert.ok(r.total >= 9, `断言项过少: ${r.total}`);
    for (const item of r.results) {
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.ok, 'boolean');
      assert.ok(item.message && item.message.length > 0, `断言项 ${item.name} 缺少诊断信息`);
    }
  });

  it('反向自检：违规假驱动被抓出来', async () => {
    const r = await runDriverComplianceTests((opts) => new CheatingDriver(opts));
    const failedNames = r.results.filter((x) => !x.ok).map((x) => x.name);
    assert.ok(r.failed >= 1, '套件未能抓出违规驱动（疑似空壳）');
    assert.ok(failedNames.includes('moveToTrash-soft-delete'), `未抓出物理删除红线: ${JSON.stringify(r.results, null, 2)}`);
    assert.ok(failedNames.includes('upload-progress-monotonic'), `未抓出不触发进度回调: ${JSON.stringify(r.results, null, 2)}`);
    assert.ok(failedNames.includes('upload-abort-signal'), `未抓出忽略 AbortSignal: ${JSON.stringify(r.results, null, 2)}`);
    assert.ok(r.passed >= 5, `预期多数项仍应通过，实际通过 ${r.passed}/${r.total}`);
  });
});
