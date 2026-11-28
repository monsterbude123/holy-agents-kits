# [驱动契约] StorageDriver SPI 接入指南

> **面向对象**：百度网盘 / 夸克网盘 / 其它第三方网盘驱动的开发者（外部 Agent）。
> **权威实现**：`scripts/driver_spi.mjs`（基类）与 `scripts/local_driver.mjs`（参考实现）。
> **你写错，别人就实现错**：本文件与 `driver_spi.mjs` 是同一份契约的两面，改一处必须同步另一处。

## 1. 你要交付什么

一个类，继承 `BaseDriver`，实现 9 个 `_xxx` 钩子，即可被本技能的 CLI、协调器、生命周期引擎直接驱动。**不要另立一套上传/下载/删除语义**——上层（打包 → 上传 → 校验 → 回写索引 → 淘汰）完全依赖本契约的时序与返回值。

```javascript
import { BaseDriver, DriverError, DRIVER_ERROR_CODES } from '<SKILL_ROOT>/scripts/driver_spi.mjs';

export class BaiduDriver extends BaseDriver {
  get driverType() { return 'baidu'; }   // 'local' | 'sftp' | 'smb' | 'baidu' | 'quark'
  async _upload(localSrc, remoteDst, options) { /* ... */ }
  // ... 其余钩子
}
```

## 2. 五步接入

1. `extends BaseDriver`，覆写 `get driverType()` 返回介质标识。
2. 实现 `_upload` / `_download`，**必须真的接 `onProgress` 与 `signal`**（大文件有进度条、Ctrl+C 能立刻中断）。
3. 实现 `_exists` / `_stat` / `_list`，路径规整后语义与本地盘一致。
4. 实现 `_moveToTrash`（软删除）与 `_purge`（物理抹除），淘汰只进 `.trash/`，绝不直接删。
5. 实现 `_readIndex` / `_writeIndex`（原子写），崩溃后远端索引零污染。

## 3. 契约方法签名

公共方法是 **final 模板**：基类已完成路径规整、参数校验、中断检查，再委派给你的 `_xxx` 钩子。**不要覆写公共方法**。

```javascript
/** 驱动标识：'local' | 'sftp' | 'smb' | 'baidu' | 'quark' */
get driverType(): string

/** 连通性探活与鉴权校验。成功返回 { ok: true, driverType, root }，失败抛 DriverError */
async ping(): Promise<{ ok: boolean, driverType: string, root: string }>

/**
 * 上传文件（本地 → 介质）。
 * @param {string} localSrc   本地源文件绝对路径（已规整为正斜杠）
 * @param {string} remoteDst  介质端目标路径（已规整；相对路径以介质根为基准）
 * @param {{ onProgress?: (transferred: number, total: number) => void,
 *           signal?: AbortSignal }} [options]
 * @returns {Promise<{ bytesWritten: number, sha256: string }>}
 */
async upload(localSrc, remoteDst, options = {}): Promise<{ bytesWritten: number, sha256: string }>

/** 下载文件（介质 → 本地）。参数与返回同 upload()，options 可选 */
async download(remoteSrc, localDst, options = {}): Promise<{ bytesWritten: number, sha256: string }>

/** 远端路径是否存在 */
async exists(remotePath): Promise<boolean>

/**
 * 远端元数据。
 * @returns {Promise<{ path: string, name: string, size: number,
 *                     mtimeMs: number, isDirectory: boolean, isFile: boolean }>}
 */
async stat(remotePath): Promise<object>

/** 列出远端目录（prefix 缺省 = 介质根），返回 stat() 同构的条目数组 */
async list(remoteDirPrefix = ''): Promise<object[]>

/**
 * 软删除：把远端文件移入回收站（`<trashPrefix>/<ts>_<原名>`）。
 * 严禁物理删除——这是防灾红线。
 * `trashPrefix` 基准 = 介质根 root：相对路径（如 `.trash`）解析为 `<root>/.trash`，
 * 绝对路径直接使用；留空取基类默认 `this.trashRoot`（即 `<root>/.trash`）。
 * @returns {Promise<{ from: string, to: string }>}
 */
async moveToTrash(remotePath, trashPrefix = ''): Promise<{ from: string, to: string }>

/**
 * 物理抹除。全流程唯一允许真正删除文件的入口。
 * **只允许 lifecycle 模块在 TTL 冷却期满后调用**，禁止在其它路径调用。
 */
async purge(remotePath): Promise<void>

/** 读取介质端轻量 JSON 索引；索引不存在返回 null */
async readIndex(): Promise<object | null>

/** 原子回写介质端 JSON 索引（content 为对象或字符串） */
async writeIndex(content): Promise<void>
```

### 3.1 子类钩子清单（你要实现的 9 个）

`_upload` / `_download` / `_exists` / `_stat` / `_list` / `_moveToTrash` / `_purge` / `_readIndex` / `_writeIndex`

未实现时基类统一抛 `GSS_E_NOT_IMPLEMENTED`，便于上层降级而不是崩栈。

### 3.2 路径规整由基类兜底

基类在所有路径出入口调用 `normalizeStoragePath()`：反斜杠转正斜杠，**并保留 UNC 双斜杠前缀**（`//nas/share` 不会被压成 `/nas/share`）。你的钩子拿到的路径已是规整后的；拼接子路径请用 `this.joinPath(base, ...parts)`，不要用 `node:path` 的 `join`（Windows 下会压掉 UNC 前缀，网络驱动器直接不可访问）。

基类还提供 3 个**公开工具方法**（继承即可用，外部驱动请优先复用，不要自己重写路径逻辑）：

```javascript
this.norm(p)                       // 路径规整（UNC 前缀保护）
this.joinPath(base, ...parts)      // 路径拼接（UNC 前缀保护）
this.trashRoot                     // 介质回收站目录 = <root>/.trash
```

`normalizeStoragePath(p)` 与 `joinStoragePath(base, ...parts)` 也已具名导出，可在基类之外单独引用。

## 4. 错误码清单

所有失败一律抛 `DriverError`，其 `code` 取自下表。**不要抛裸 `Error`**，上层按 `code` 分支处理（重试 / 降级 / 人工介入）。

| 错误码 | 含义 | 典型触发 | 上层建议动作 |
| --- | --- | --- | --- |
| `GSS_E_NOT_IMPLEMENTED` | 钩子未实现 | 新驱动漏实现某能力 | 标记该目标不支持该能力 |
| `GSS_E_INVALID_ARG` | 参数非法 | 路径为空、类型不对 | 视为调用方 bug，直接报错 |
| `GSS_E_NOT_FOUND` | 远端对象不存在 | `stat` / `list` 目标缺失 | 幂等处理，跳过 |
| `GSS_E_EXISTS` | 目标已存在 | 需要独占创建 | 提示用户或先 trash |
| `GSS_E_PERMISSION` | 权限不足 | 鉴权失效、只读介质 | 重新鉴权 / 换目标 |
| `GSS_E_NETWORK` | 网络不可达 | 网盘服务抖动、断网 | 指数退避重试 |
| `GSS_E_ABORTED` | 被 `AbortSignal` 中断 | 用户 Ctrl+C | 静默收场，不算故障 |
| `GSS_E_TIMEOUT` | 超时 | 大文件长时间无响应 | 缩片重试或换通道 |
| `GSS_E_CHECKSUM` | 校验和不符 | 上传/下载内容被篡改或损坏 | 触发 `moveToTrash` 回滚半成品 |
| `GSS_E_CROSS_DEVICE` | 跨设备移动失败 | 跨盘符 / 跨分区 | 降级为「复制 → 校验 → 删除源」 |
| `GSS_E_TRASH_FAILED` | 软删除失败 | 回收站目录不可写 | 阻止淘汰，先修介质 |
| `GSS_E_IO` | 通用 I/O 失败 | 读写异常 | 重试一次，仍失败则上报 |
| `GSS_E_UNSUPPORTED` | 能力不支持 | 介质无原子改名等 | 走降级路径 |
| `GSS_E_CONFIG` | 配置错误 | 缺 endpoint / 凭据 | 提示补配置 |
| `GSS_E_RATE_LIMIT` | 被限流 | 第三方网盘配额耗尽 | 退避到限流窗口后再试 |

`DRIVER_ERROR_CODES` 常量已导出，直接用 `DRIVER_ERROR_CODES.GSS_E_ABORTED`，不要手写字符串。

## 5. 生命周期时序（上层如何驱动你）

**5.1 push（推送快照）**

```
打包 → driver.upload(localBundle, remoteName, { onProgress, signal })
     → 上层比对 bytesWritten 与 sha256
     → 一致 → driver.writeIndex(indexObj)   ← 索引只在载荷校验通过后回写
     → 不一致 → driver.moveToTrash(半成品)   ← 状态零污染
```

**5.2 pull（拉取恢复）**

```
driver.readIndex() → 选定条目 → driver.download(remoteName, localPath)
                  → 上层校验 sha256 → 还原到工作区
```

**5.3 prune（软淘汰，默认 Dry-Run）**

```
上层判定超期快照 → driver.moveToTrash(remotePath, trashPrefix)
                → 介质端出现 .trash/<ts>_<原名>，冷却期 N 天内可秒级回滚
```

**5.4 clean-trash（物理抹除，仅 `--yes`）**

```
扫描 .trash/ → 判定 TTL 到期 → 先在索引标记 purged 并原子落盘
             → 再调 driver.purge(path)      ← 物理删除只发生在这里
```

**顺序不可颠倒**：索引先行记账，避免索引挂着死引用。

## 6. 最小驱动实现模板

复制即用，只需把 `_upload` / `_download` 里的 `TODO` 换成你的网盘 API 调用。

```javascript
// my_pan_driver.mjs — 第三方网盘驱动模板
import { BaseDriver, DriverError, DRIVER_ERROR_CODES as E } from '<SKILL_ROOT>/scripts/driver_spi.mjs';

const INDEX_NAME = '.ghh-index.json';

export class MyPanDriver extends BaseDriver {
  /** @param {{ root?: string, endpoint?: string, token?: string }} [options] */
  constructor(options = {}) {
    super(options);
    this.token = options.token ?? process.env.MY_PAN_TOKEN;
  }

  get driverType() { return 'baidu'; }

  async ping() {
    if (!this.token) throw new DriverError(E.GSS_E_CONFIG, 'missing token');
    try {
      await this._api('/quota');
    } catch (err) {
      throw new DriverError(E.GSS_E_NETWORK, 'ping failed', err);
    }
    return { ok: true, driverType: this.driverType, root: this.root };
  }

  /** 上传：必须真的调用 onProgress，并把 signal 透传给底层请求 */
  async _upload(localSrc, remoteDst, { onProgress, signal } = {}) {
    this.throwIfAborted(signal);
    const meta = await this._api(`/stat?path=${encodeURIComponent(remoteDst)}`);
    const total = Number(meta.size ?? 0);
    // TODO: 流式上传；每收到一个分片就调用 onProgress(bytes, total)
    // TODO: signal 触发时立刻中断 HTTP 请求，并抛 GSS_E_ABORTED
    onProgress?.(total, total);
    return { bytesWritten: total, sha256: meta.sha256 ?? '' };
  }

  /** 下载：同样是流式 + 可中断 */
  async _download(remoteSrc, localDst, { onProgress, signal } = {}) {
    this.throwIfAborted(signal);
    // TODO: 拉流写本地文件，边写边回报进度
    return { bytesWritten: 0, sha256: '' };
  }

  async _exists(remotePath) {
    try {
      await this._api(`/stat?path=${encodeURIComponent(remotePath)}`);
      return true;
    } catch (err) {
      if (err?.code === E.GSS_E_NOT_FOUND) return false;
      throw err;
    }
  }

  async _stat(remotePath) {
    const raw = await this._api(`/stat?path=${encodeURIComponent(remotePath)}`);
    return {
      path: remotePath, name: raw.name, size: Number(raw.size ?? 0),
      mtimeMs: Number(raw.mtimeMs ?? 0), isDirectory: Boolean(raw.isDirectory), isFile: !raw.isDirectory,
    };
  }

  async _list(remoteDirPrefix) {
    const raw = await this._api(`/list?path=${encodeURIComponent(remoteDirPrefix)}`);
    return (raw.items ?? []).map((it) => ({
      name: it.name, path: it.path, size: Number(it.size ?? 0),
      mtimeMs: Number(it.mtimeMs ?? 0), isDirectory: Boolean(it.isDirectory), isFile: !it.isDirectory,
    }));
  }

  /** 软删除：移动到回收站目录，绝不直接删 */
  async _moveToTrash(remotePath, trashPrefix) {
    const trash = trashPrefix || this.joinPath(this.root, '.trash');
    const to = this.joinPath(trash, `${Date.now()}_${remotePath.split('/').pop()}`);
    await this._api('/move', { from: remotePath, to });
    return { from: remotePath, to };
  }

  /** 物理抹除：仅 lifecycle 冷却期满后调用 */
  async _purge(remotePath) {
    await this._api('/delete', { path: remotePath });
  }

  async _readIndex() {
    const raw = await this._api(`/download?path=${encodeURIComponent(this.joinPath(this.root, INDEX_NAME))}`);
    return raw ? JSON.parse(raw) : null;
  }

  /** 原子写：先写临时名再改名，中间态不会让上层读到坏 JSON */
  async _writeIndex(content) {
    const target = this.joinPath(this.root, INDEX_NAME);
    const tmp = `${target}.tmp`;
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await this._api('/upload', { path: tmp, body: text });
    await this._api('/move', { from: tmp, to: target });
  }

  /** TODO: 换成你的真实 API 调用；异常请映射为上表错误码 */
  async _api(_path, _body) {
    throw new DriverError(E.GSS_E_NOT_IMPLEMENTED, 'wire your HTTP client here');
  }
}
```

## 7. 合规自检

**自动验收已就绪**：把 driver 传给本技能的合规套件即可一键跑完 9 项断言——
`import { runDriverComplianceTests } from '<SKILL_ROOT>/scripts/test/compliance_harness.mjs'`
`const r = await runDriverComplianceTests(() => new MyPanDriver({ root, ...credentials }));`
返回 `{ passed, failed, total, driverType, results: [{ name, ok, message }] }`，逐项失败带可定位诊断。
套件只依赖驱动的公开方法，不 import 任何具体驱动，可直接复制进你的驱动仓库。
覆盖项：ping / 上传内容一致 / 覆盖写 / 软删除进回收站 / 索引往返 / 索引原子写 / 进度单调递增 / AbortSignal 中断 / UNC 路径规整。
**建议**：提交前先跑套件，绿灯再人工复核一遍错误码使用与 `purge` 的调用边界。

## 8. 禁止事项

1. **禁止物理删除**代替 `moveToTrash`——淘汰一律进 `.trash/`，物理抹除只在 `purge`。
2. **禁止在钩子里吞掉异常**——失败必须抛带 `code` 的 `DriverError`。
3. **禁止整文件读入内存**做上传/下载/校验——必须流式。
4. **禁止用 `node:path` 的 `join` 拼远端路径**——会压掉 UNC 前缀，用 `this.joinPath()`。
5. **禁止硬编码本机绝对路径**——端点与凭据一律走 `.agents/.env`。
6. **禁止覆写基类公共方法**——只实现 `_xxx` 钩子，否则路径规整与错误归一会被绕过。

## 9. 相关文件

- `scripts/driver_spi.mjs`：基类、路径规整、错误码（权威实现）
- `scripts/local_driver.mjs`：本地盘 / 挂载盘参考实现（含 EXDEV 兜底）
- `scripts/test/local_driver.test.mjs`：断言口径样例（可复制到你的驱动仓库）
- `scripts/test/compliance_harness.mjs`：合规测试套件（`runDriverComplianceTests`，外部驱动一键验收）
- `references/storage-design.md` / `references/rules.md`：介质物理布局与防灾铁律
