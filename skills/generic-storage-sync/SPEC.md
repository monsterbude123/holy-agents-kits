# [SPEC] 通用多源异构存储同步架构设计规格书 (Generic Storage Sync)

> **版本**：v1.0.0  
> **定位**：面向轻量级本地缓冲盘、物理挂载盘、远程共享（SFTP/SMB）及第三方网盘（百度/夸克）的统一跨介质数据管理与同步规范。  
> **设计范式**：纯原生 `.mjs`、零编译构建、零 npm 外部依赖、解压即用、生命周期闭环。

---

## 1. 核心目标与架构原则

1. **媒介透明化（Storage-Agnostic）**：上层用户与 Agent 只感知「仓库/文件快照、版本、同步状态」，底层物理盘、本地快照盘、网络挂载（SMB/NFS/SFTP）或第三方网盘（百度/夸克）对上层完全透明。
2. **极简无依赖，拒绝大数据沉疴**：不做 HDFS/Ceph 类分布式重型存储，以单机可执行的原生 Node.js（≥ 18）标准库（`node:fs`、`node:path`、`node:crypto`、`node:child_process`、`node:test`）为核心，零重量依赖，毫秒级启停。
3. **ORM 式存储索引抽象（Storage-ORM Engine）**：上层只关心元数据实体的 CRUD 逻辑、快照指纹比对与版本生命周期，底层具体持久化为单文件 JSON、SQLite 还是网盘远端索引文件，由 Driver 独立承载。
4. **协同边界清晰**：本技能作为**通用同步核心与本地/挂载盘 Driver 权威实现**；为其他 Agent 正在构建的百度网盘、夸克网盘提供**标准 Driver 接入契约（StorageDriver SPI）**，实现即插即用。
5. **历史文件生命周期闭环（Lifecycle & Pruning）**：拒绝只存不删导致的磁盘爆炸，内置四阶渐进式淘汰与回收站机制。

---

## 2. 总体架构与多 Skill 生态拓扑

```
<技能目录>/                           # .agents/skills/（装进用户项目） 或 skills/（holy-agents-kits 本仓）
├── github-kownledge-helper/           # [业务层技能] 本地 GitHub 仓库管家
│   └── (当需要云同步/跨盘备份时，依赖并调用 generic-storage-sync)
│
├── generic-storage-sync/              # [基础层独立技能] 通用存储与缓冲同步引擎
│   ├── SPEC.md                        # 本规格设计说明书
│   ├── TICKETS.md                     # 实施工程工单
│   ├── .env.example                   # 配置模板
│   ├── SKILL.md                       # 技能主入口 (≤150行，主轴+决策表)
│   ├── scripts/                       # [纯原生 .mjs, 零构建, 跨平台]
│   │   ├── sync_cli.mjs               # 统一 CLI 总入口 (node scripts/sync_cli.mjs <cmd>)
│   │   ├── env.mjs                    # 原生 .agents/.env 解析与路径收口
│   │   ├── index_store.mjs            # ORM 风格 JSON 索引 CRUD 与差异比对
│   │   ├── driver_spi.mjs             # 驱动基类与 SPI 契约规范
│   │   ├── local_driver.mjs           # 本地磁盘 / SMB 挂载驱动 (含 Trash 保护)
│   │   ├── buffer_pipeline.mjs        # git bundle 压缩流与 SHA256 哈希计算
│   │   └── lifecycle.mjs              # 历史文件安全淘汰、Trash 冷却与物理清理
│   └── references/                    # 沉淀规则与协议
│       ├── driver-spi.md              # 供百度/夸克 Agent 对接的驱动开发契约
│       ├── storage-design.md          # 缓冲盘与索引 ORM 物理设计
│       ├── rules.md                   # 存储安全与清理红线
│       └── evolution.md               # 演进协议与日志
│
├── baidu-pan-sync/                    # [外部独立技能] 遵循 driver-spi 实现 BaiduDriver
└── quark-pan-sync/                    # [外部独立技能] 遵循 driver-spi 实现 QuarkDriver
```

---

## 3. ORM 风格索引引擎设计 (Index Engine as Storage-ORM)

### 3.1 领域模型实体定义 (Domain Entities)

```typescript
/** 仓库快照元数据实体 */
export interface SnapshotEntity {
  fullName: string;                // 仓库唯一标识，如 "facebook/react"
  group?: string;                  // 归属分组（可选）
  commitSha: string;               // Git commit 完整 SHA
  commitShort: string;             // 简短 SHA
  commitDate: string;              // 提交时间 (ISO 8601 with timezone)
  archiveName: string;             // 压缩包名，如 "facebook__react-7e7f041.bundle"
  archiveFormat: 'git-bundle' | 'tar-zst' | 'raw';
  sizeBytes: number;               // 压缩后字节数
  checksumSha256: string;          // 全文件 SHA-256 完整性哈希
  baseCommitSha?: string;          // 增量打包基准（预留）
  tags: string[];
}

/** 介质端同步记账实体 */
export interface SyncRecordEntity {
  repoFullName: string;
  targetId: string;
  syncedCommitSha: string;
  syncedArchiveName: string;
  syncedAt: string;
  status: 'synced' | 'pending' | 'drifted' | 'purged';
}
```

### 3.2 索引 CRUD 与状态机
- **物理载体**：介质根目录下的 `.ghh-index.json`（单文件、轻量、紧凑）。
- **原子落盘**：内存维护 Entity Map，落盘采用 `.tmp` + `fs.renameSync` 原子写入，彻底杜绝进程崩溃导致的半写坏库。
- **差异比对 (Diff Engine)**：纯函数比对本地快照与远端记账记录，输出 `toUpload`、`toTrash`、`upToDate` 清单。

---

## 4. 统一存储驱动接口 (StorageDriver SPI)

外部 Agent 开发百度网盘、夸克网盘驱动时，只需继承 `driver_spi.mjs` 中的 `BaseDriver` 并实现以下契约：

> **权威实现**：`scripts/driver_spi.mjs`（模板方法模式：公共方法统一做路径规整 → 参数校验 → 中断检查，再委派 `_xxx` 钩子；子类只写介质差异部分）。
> **面向外部开发者的完整契约**：`references/driver-spi.md`（接口签名 + 生命周期时序 + 15 个错误码 `GSS_E_*` + 最小实现模板）。
> 本节只是契约摘要；两者不一致时以 `scripts/driver_spi.mjs` 与 `references/driver-spi.md` 为准。

```javascript
export class BaseDriver {
  /** 驱动标识: 'local' | 'sftp' | 'smb' | 'baidu' | 'quark' */
  get driverType() { throw new Error('not implemented'); }

  /** 连通性测试与鉴权探活 */
  async ping() { throw new Error('not implemented'); }

  /** 
   * 上传文件（必须支持进度回调与中断信号）
   * @param {string} localSrcPath 
   * @param {string} remoteDstPath 
   * @param {{ onProgress?: (transferred: number, total: number) => void, signal?: AbortSignal }} [options]
   * @returns {Promise<{ bytesWritten: number, sha256: string }>}
   */
  async upload(localSrcPath, remoteDstPath, options = {}) { throw new Error('not implemented'); }

  /** 下载文件 */
  async download(remoteSrcPath, localDstPath) { throw new Error('not implemented'); }

  /** 检查远端是否存在 */
  async exists(remotePath) { throw new Error('not implemented'); }

  /** 获取远端元数据 */
  async stat(remotePath) { throw new Error('not implemented'); }

  /** 软删除移入回收站 (防灾红线：禁止直接物理 unlink) */
  async moveToTrash(remotePath, trashPrefix) { throw new Error('not implemented'); }

  /** 物理清除过期文件 (仅由 lifecycle 模块在超过 TTL 冷却期后调用) */
  async purge(remotePath) { throw new Error('not implemented'); }

  /** 读取远端轻量 JSON 索引（无索引文件时返回 null；已解析对象，非字符串） */
  async readIndex() { throw new Error('not implemented'); }

  /** 回写远端轻量 JSON 索引（接受对象或字符串；原子写 .tmp + rename） */
  async writeIndex(content) { throw new Error('not implemented'); }
}
```

> **索引 schema 唯一事实源 = `scripts/index_store.mjs`**。驱动层只做**字节透传**，不得自定义索引结构。
> 固定结构：`{ version: '1.0', updatedAt, snapshots: {}, syncRecords: {}, targets: {} }`。

---

## 5. 本地缓冲盘与打包管道 (Buffer Pipeline)

### 5.1 暂存流转拓扑
```
[工作空间 repos/] (原始全量代码，只读追踪)
       │
       ▼ (sync_cli.mjs pack)
[本地缓冲盘 buffer/] (高效压缩块，热缓存)
   ├── .staging/           (打包中间体，失败即删)
   ├── .trash/             (软淘汰快照，冷却期保护)
   ├── .ghh-index.json     (本地 Storage-ORM 快照库)
   └── <owner>__<repo>-<sha>.bundle
       │
       ▼ (sync_cli.mjs push)
[云盘/远端存储 Target] (冷备份与多机共享)
   ├── .trash/             (远端回收站)
   ├── .ghh-index.json     (极简全局索引，供快速检索)
   └── <owner>__<repo>-<sha>.bundle
```

### 5.2 打包规范
- 默认采用 `git bundle create <file> --all`，完整包含分支与 tags；
- 打包同时通过 Node 原生 `node:crypto` 流式生成 SHA-256，无需二次读盘。

---

## 6. 四阶历史清除管道与生命周期管理 (Pruning & Lifecycle)

### 6.1 四阶淘汰流
1. **阶段 1 (版本淘汰判定)**：新快照推送成功后，检查 `STORAGE_MAX_RETAINED_SNAPSHOTS`（默认 2 个），标记超出保留数的旧版本。
2. **阶段 2 (软淘汰移入回收站)**：驱动调用 `moveToTrash`，将旧快照移至对应介质的 `.trash/<ts>_<archive>`。
3. **阶段 3 (TTL 冷却期保护)**：在 `.trash/` 中静置冷却 N 天（默认 7~14 天，由 `STORAGE_TRASH_TTL_DAYS` 指定）。期间支持随时回滚。
4. **阶段 4 (物理硬抹除)**：显式运行 `clean-trash --yes`，驱动物理删除超期文件，并同步核销索引记账。

### 6.2 防灾四铁律
- **绝对保底律**：任何仓库在任何介质上**必须至少保留 1 个最新可用快照**，严禁将历史清零！
- **演练优先律**：所有清理指令（`prune` / `clean-trash`）**默认全走 Dry-Run**，非交互必须显式带 `--yes`。
- **两阶段防分叉**：物理删除前必须先在索引中记账核销，避免索引挂着死引用。
- **孤儿防御**：扫描到未登记的文件不直接删，先隔离至 `.trash/orphans/`。

---

## 7. 统一 CLI 命令行交互规范

```bash
# 介质管理
node scripts/sync_cli.mjs target list
node scripts/sync_cli.mjs target add <id> --type local --endpoint <path>
node scripts/sync_cli.mjs target test [id]

# 同步与状态
node scripts/sync_cli.mjs status                     # 查看本地与各介质差异
node scripts/sync_cli.mjs diff <target>              # 查看漂移清单
node scripts/sync_cli.mjs pack <repo_path> [--name <owner/repo>]      # 打包单仓到缓冲池
node scripts/sync_cli.mjs push <repo_path> [--target <id>] [--name <owner/repo>]  # 推送快照到指定介质
node scripts/sync_cli.mjs pull <owner/repo> --from <id> [--dest <path>]    # 从介质拉回并恢复

# 安全清理 (默认全是 Dry-Run)
node scripts/sync_cli.mjs status --trash             # 查看回收站占用
node scripts/sync_cli.mjs prune [target]             # 演练淘汰旧版本
node scripts/sync_cli.mjs prune [target] --yes       # 执行软淘汰进 Trash
node scripts/sync_cli.mjs clean-trash [target]       # 演练物理清理
node scripts/sync_cli.mjs clean-trash [target] --yes # 物理抹除冷却期满的 Trash
node scripts/sync_cli.mjs clean-staging [--dry-run] # 清除异常中断的暂存残卷
```
