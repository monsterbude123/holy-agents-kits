# Changelog

本文件是本仓库的**首版**发布说明 —— 只从 0.8.0 起记。

> ⚠️ **口径**：0.8.0 是 npm 上的第一个带本文件的版本。**已装 0.7.0 的用户看不到本期之前的增量**（0.7.0 及更早没有本文件）—— 这里不假装有历史，往后每版往下追加。

## 0.15.0（未发布）

> **新增一个技能**：`video-study` —— 把一个视频（课程/技术分享/讲座/教程/播客）加工成
> 可直接用的学习材料。技能数 20 → 21。

### 变更

- **新增 `video-study` —— 视频学习加工**
  - 产出 = `<视频名>/` 一个目录：图文笔记 `note.md`（屏幕内容配口播要点，按章节编排、
    全带时间戳）+ 结构化学习包 `study/`（必产导航/逐主题原理深挖/术语速查，
    概念迁移表、题库、动手验收标准、前置知识清单按学习者画像裁剪）
  - **机械层复用宿主已有视频工具**（video-agent-kit 转写与采样、video2code、ffmpeg 降级），
    不手搓 ASR；没有转写能力就停下报告
  - 纪律：数字必须可溯源到视频原话或画面；需要学习者本人真实经历处用 `[填空]` 占位不代填；
    原理篇必须答「为什么这样设计 + 什么时候失效」
  - 纯方法论技能（无 scripts/ 无凭据）：判断与模板在正文与 references，工具对照表写明三级降级路径

## 0.14.0

> **新增两个技能**：一个把 GitHub 仓库变成可检索的本地知识库（`github-kownledge-helper`），
> 一个把「存到哪都行」的介质差异彻底屏蔽掉（`generic-storage-sync`）。两者**零代码耦合**，
> 跨技能调用只留命令指针。技能数 18 → 20。

### 变更

- **新增 `github-kownledge-helper` —— 本地 GitHub 仓库管家**
  - 收录 / 更新 / 一键全更：`add` `update` `update-all` 走 ff-only，**绝不改第三方仓库源码**
  - 知识沉淀：顶层文档同步到 `docs/`、建索引与文档地图、`manifest.json` 作唯一事实源（原子写入）
  - 实测答疑：`query` 用本地 git 实测回答 commit / tag / 版本号，附新鲜度标注（🟢/🟡/🔴）
  - 镜像：`sync-to <repo> <绝对路径>` 含 `.git`，可把单个仓搬去任意盘
  - 零构建零依赖：原生 `.mjs` + Node ≥22 内置模块，**87 个用例**
- **新增 `generic-storage-sync` —— 通用异构存储同步**
  - **介质透明**：上层只认「快照实体」，底层是物理盘 / 挂载盘 / SFTP / SMB / 网盘都一样
  - 打包与推送：`pack` 出 git bundle + SHA-256，`push` 两阶段提交，`pull` 拉回还原，
    崩溃后凭远端 `.ghh-index.json` 重建本地索引
  - **索引只记每仓当前版本**，历史版本清单以**介质目录**为准 —— 淘汰判定靠「介质目录 + 索引记账」
    组装，不靠索引猜
  - **物理删除只有一个出口**：`clean-trash --yes` 且冷却期满（窗口 `[0, TTL)`，恰好等于 TTL 即到期）
    才真正删文件；其它路径一律软删除进 `.trash/`。`prune` / `clean-trash` 默认 dry-run，
    只报清单与可释放字节数
  - **驱动 SPI 抽象**：新介质继承 `BaseDriver` 即可接入，必须跑通技能自带的合规套件；
    百度 / 夸克驱动由对应 Agent 实现（本版只交付契约与套件）
  - 零构建零依赖：原生 `.mjs` + Node ≥18 内置模块，**105 个用例**
- **门面同步**：README 导语 / mindmap / 技能一览表 / 详解节 / 仓库结构 五处补齐，
  标题「十八个技能」→「**二十个技能**」，`check-readme-sync.mjs` 四面全对账通过
- **测试接入门禁**：两个技能的 192 个用例接进 `npm test`，不再是「装了但没人跑」
- **版本**：0.13.3 → 0.14.0

## 0.13.3

> 补丁版：入库评审（2026-11-28）修出的 6 个问题 —— 一个潜在的「再次全绿假成功」漏洞、
> 一个跨扫描口径错位，加三个友好度提升。

### 变更

- **修：`move` 的整批拒绝判定漏了 `errno:12 + info 为空` 的组合**
  上一版硬失败条件豁免了 `errno===12`，但「整批被拒且无逐项 info」正是 12 的表现之一 ——
  这批会滑进幂等回查，可能再次造成「全绿但没传」。
- **修：`deep` 的深度语义错位**
  `depth` 列是**相对各扫描根**的（每次 scan 从 root 记 0），全扫与深扫混在一个库时
  `deep --max-depth=N` 的口径完全不同。改用**绝对层数**（路径斜杠数），与 `dirSizes` 口径一致。
- **修：反例清单计数漂移**
  `counter-examples.md` 拆分后只剩 19 条，SKILL.md/INDEX.md 还写着「33 个」——
  正是评审协议里记录过的 P2 漂移形状。改为「19 + 14 = 33」两个文件各标各的。
- **友好度：切片大小按会员等级自动选**
  `transfer upload/hash` 不给 `--slice` 时调 `uinfo` 探测会员等级（SVIP→32MB，实测
  比 4MB 档快 70%），探测失败回落 4MB 安全档；`model-backup upload` 不再写死 4MB。
  之前写了 `sliceSizeFor()` 却一直没接线 —— 评审抓出的死代码，现在接上了。
- **友好度：`download` 自动按台账校验 sha256**
  不给 `--expect-sha256` 时，自动从台账查这条 remote **上传时**记录的哈希并校验 ——
  「传上去再下回来」的闭环不再需要手工复制哈希。
- **收编：`human()` 三份拷贝并进 `args.mjs`**；`parseLoose`/`extractJson` 挪进
  `xpan-api.mjs` 并导出，selftest 加 10 项断言（含 MCP 实测的截断形状），
  **变异检验确认有牙**（把补括号分支失效，自测立刻红）。

## 0.13.2

> 补丁版：修移动器与盘点器的四个 bug —— 都是**真做一次批量隔离 335 个重复副本**时暴露的。
> 其中一个是「全绿但一次都没传出去」的假成功，值得单独看一眼。

### 变更

- **P0：MCP 返回的 JSON 末尾少一个 `}`，被幂等回查掩盖成「全绿」**
  MCP 的 `file_move` 返回文本**末尾少一个右花括号**（花括号 2 vs 1）→ `JSON.parse` 失败 →
  `info[]` 永远为空 → 每项都判「失败」；而失败后走的幂等回查
  （「源不在 + 目标已在 = 已完成」）又把上一轮搬过的文件判成「已就位」。
  结果：批量搬 335 个文件报「335 成功 0 失败」，**实际一次都没发出去**。
  修：解析改**宽松**（按花括号配对扫出第一个 JSON 对象，缺右括号就补齐再 parse）；
  **调用层被拒（`params error` / `errno:2`）硬失败**，不再落到幂等回查那条路上。
- **P1：MCP 的 `filelist` 参数类型是 JSON 字符串，不是数组**
  传数组 → `params error: (response.body:{"errno":2,...})`，所有项报 `no-info`。
  工具描述写「json串数组」、示例却给数组 —— **以服务端报为准**。
- **P1：批量里一个超大目录会把整批拖垮**
  3 个目录一批（218GB / 228GB / 744GB）→ 3 个全失败；逐个提交后两个小的都成了。
  修：**目录级移动逐个提交**（`async=1` 时步长=1），文件级小批量照旧。
- **P1：扫描不剪掉已消失的路径 → 体量被重复计算**
  隔离搬走 335 个文件（1.35 TB）后重扫，库里体量从 **7.06 TB 涨到 8.45 TB**
  —— 被搬走的文件留下「旧路径 + 新路径」两行，体量算了两遍。
  修：扫描时对**每个确实列到的目录**，删掉「声称是它子项、但实际不在列表里」的行；
  **列举失败时绝不删**（一次网络抖动就会抹掉整棵子树的记录）。
- **补：`async=1` 的「已受理未落地」要区分于「失败」**
  受理成功时服务端返回 `taskid` 且 `info` 为空；脚本改为**轮询到源消失再判定**，
  超时则报「已提交未落地」而不是「失败」。
- **反例清单 29 → 33 条**；`references/api-quirks.md` 补 `errno:-8` 的第二种含义
  （目标已有同名文件，含大小写变体 —— 网盘文件名**大小写不敏感**）。

### 实测

- 335 个重复副本（1.35 TB）隔离完成：目标 `/90_待清理/重复副本/` **335 个文件 / 1.35 TB**，全部源路径已空
- 全量幂等复核 **335/335 成功、0 失败**（且这次是真的解析到了 `info[]`）
- A 档两个陈旧目录（藏语教程 213 GB + Adobe2022全家桶 204 GB）已可逆地隔离到 `/90_待清理/旧内容/`

## 0.13.1

> 补丁版：修 `baidu-netdisk-mcp` 移动器的三个真 bug —— 都是**批量隔离 335 个重复副本**时
> 才暴露出来的（错报失败、文件留在原地、目标目录撞名）。

### 变更

- **P1：幂等回查只查第 1 页 → 已搬好的文件被误报成失败**
  回查用 `file_list` 查目标目录，但**每页只有 10 条**。目标目录有 300+ 项时，
  「目标已在」永远判否 —— 实测 335 项里 **85 项误报失败**（实际全部已隔离）。
  修：回查**翻页拉全量** + **按目录缓存**（逐项翻页会把 335 项变成几千次调用，
  实测跑 10 分钟没完）+ **每批失效目标目录的缓存**（目标内容每批都在变，
  用旧列表还是误判）。
- **P1：批量搬到同一目录，169 项因目标名重名被拒（errno -8）**
  335 个重复副本里有 62 个名字重复（最多的一个 5 份），`ondup:'skip'` 不覆盖 → 直接拒，
  那批文件**留在原地，空间没释放**。
  修：spec 生成时**目标名去重**（同名第二个起加 `__2`/`__3`），且**按小写比较** ——
  网盘文件名**大小写不敏感**（`instantID_x` 与 `instantid_x` 视为同名，这俩撞名也报 -8）。
- **P1：幂等回查只按 spec 里的目标名查 → 上一轮已搬的副本仍被误报**
  上一轮搬过去的副本在隔离区里用的是**原名**，而新一轮 spec 给的是带后缀的名字，
  按新名字查自然查不到。修：回查同时看**源文件的原名**。
- **`filelist` 改为直接传数组**（MCP schema 就是数组，之前传的是 JSON 字符串）。
- **反例清单 27 → 29 条**，新增两条：批量隔离时忘了目标名会重名、幂等回查只查第 1 页。
- `references/api-quirks.md` 补 **`errno:-8` 的第二种含义**：目标已有同名文件
  （含大小写变体）也会报 -8，不只是「超大目录被同步模式拒」。

### 实测

用这套修复后的移动器隔离 **335 个重复副本 = 1.35 TB**（≥1GB 的重复组全部处理完）：
目标目录 `/90_待清理/重复副本/` 最终 335 个文件 / 1.35 TB，全部源路径已空。

## 0.13.0

> **这一版把 `baidu-netdisk-mcp` 的传输层做成了原生分片协议** —— 上传下载从此有进度、有速度、
> 能断点续传、能用 sha256 端到端校验；并修掉两个「不报错但结论是假的」的 P0/P1。

### 变更

- **P0：`dup --min-size=50MB` / `big --min=5GB` 一直是哑弹**
  `Number('50MB')` 是 NaN，`size >= NaN` 恒假 → `dup` 永远返回 0 组 0 字节；
  `big` 的单位查表漏了 `'GB'` 键 → 阈值从 5GB 变成 5 字节。
  同一份库里实际有 **549 组、282GB** 可回收，却被报告成「网盘里没有重复文件」。
  修法：抽出 `scripts/args.mjs`（三个脚本共用一份解析），体积认 `B/K/KB/M/MB/G/GB/T/TB`，
  **解析不出来直接报错退出 1**，不再静默当成 0。
- **P1：`plan` 的校验白名单只收目录** → 文件级移动（重复副本、旧版本这类搬单个文件的场景）
  一项都过不了，计划直接空掉。修：白名单收全部路径，体积取值分「目录用汇总 / 文件用自身 size」两路。
- **新增原生分片传输层**（`skills/baidu-netdisk-mcp/scripts/transfer.mjs`）
  - 协议三段式（百度官方 Go SDK `uploadsdk`）：`precreate` → `d.pcs.baidu.com` 分片上传 → `create`
  - **进度**：每片一个刻度，实时速度 + ETA（滑动窗口，不是全程平均）
  - **断点续传**：**服务端驱动** —— precreate 告诉你「还缺哪几片」，只补缺的；
    本地文件若已改变，状态自动作废重来（否则会拼出损坏文件）
  - **校验**：片级标准 md5（对齐百度 `block_list` 协议）+ 文件级 sha256 记我们自己的账
  - **并发保护**：同一远端路径同时只能有一个传输进程（僵尸锁按 pid 自动回收）
  - 另含 `scripts/hashes.mjs`（流式 sha256 + 分片 md5）与 `scripts/xpan-api.mjs`（协议层）
- **哈希口径定案（两级，各司其职）**：片级 **标准 md5**（百度协议要求）、
  文件级 **sha256**（我们的账本）；**网盘返回的 md5 是闭源变种**（实测 ≠ 标准 md5，
  20+ 种常见变换全部对不上），只当网盘侧身份标识，**不参与本地校验**
- **原生协议能写整个网盘**，不像 bdpan CLI 只能碰 `/apps/bdpan/` —— 实测 `/99_索引/` 一样能建档
- **反例清单 12 → 27 条**，新建「测试与评审」组；含几条方法论级的：
  块内 `const` 遮蔽外层同名变量（TDZ → 校验一次都没跑过）、
  断言自引用被测常量（同义反复，变异检验不红）、评审只跑 grep 就收工
- **自测 0 → 61 项**，接入 `npm test` 门禁；变异检验确认每组测试都有牙
  （把切片常量改错、把分片偏移改 1、把锁改失效，自测都立刻红）

### 实测（单账号单网络，仅作量级参考）

| 用例 | 结果 |
|---|---|
| 2.3 GB 上传（144 片 × 16MB） | 473 s，平均 4.9 MB/s，远端大小核对通过 |
| 2.3 GB 下载回环 | 82.1 s，28.1 MB/s，sha256 一致，`cmp` 逐字节一致 |
| 2 GB 边界分片偏移 | 2.3 GB 稀疏文件逐片对拍 144 片 → 0 处错位 |
| 切片档 | 4MB / 16MB / 32MB 三档实测均可用 |

## 0.12.0

> **这一版新增两个技能** —— `baidu-netdisk-mcp`：盘点并治理百度网盘（目录树灌**本地 SQLite**，
> 治理走「隔离 → 重排 → 索引」三步，全是服务端 move、可逆）；`doc-map-manager`：给 docs/ 建结构化索引
> （SQLite + 链接图谱 + 新鲜度评分），agent 查文档的统一入口。

### 变更

- **新增技能 `baidu-netdisk-mcp`**（`skills/baidu-netdisk-mcp/`）
  - `scripts/baidu-netdisk-db.mjs` —— 本地盘点库：`scan` 灌库（增量、双上限）/ `stats` / `du` / `big` /
    `dup` / `deep` / `find` / `plan` / `dump`；stdout 单行 JSON 信封，人读表格走 stderr
  - `scripts/baidu-netdisk-move.mjs` —— 幂等移动器：小批量 + `async:0` + 逐项解析 `info[]`，
    遇 `errno -9`（源已被搬走）回源/目标核对
- **新增技能 `doc-map-manager`**（`skills/doc-map-manager/`）
  - `scripts/build-index.py` —— docs/ 建索引：标题/章节行号/面包屑 + 链接图谱 + 标签 + 新鲜度评分
  - `scripts/query-index.py` —— `--grab` / `--lookup` / `--context-mode` / `--impact` / `--detect-changes`；
    索引库禁止直接 Read，必须走查询口
  - 语义检索（ChromaDB/Zvec）为可选增强，缺失自动降级标准库；需 Python ≥ 3.9
- **目录体积走网盘自己的 `dirsize` 接口**，不自己枚举文件累加 —— 深层树上枚举会少算一半
  （实测一棵树枚举得 281 GB、官方 727 GB）。接口与 openapi/web 两侧鉴权差异记在 `references/dirsize.md`
- **反例清单 `references/counter-examples.md`** —— 12 个已踩过的坑（分页每页 10 条、`make_dir` 默认重命名、
  `category` 字段不可靠、`file_move` 的 async 语义、`AbortSignal.timeout` 不保活、Git Bash 路径转换…）
- **全仓评审修复**（任务票 T01-T10）：P0×1 / P1×7 / P2 批，覆盖 jenkins-cli、idea-backend、
  fy-new-api-app-framework、website-helper-skill 等；含 `outfit-demo` AGENTS.md join 断言修正与
  评审协议三共性条目

## 0.10.3

> **这一版给 `jenkins-cli` 补齐 5 个 P0 + 3 个 P1 缺口** —— 来源是 deploy-services 仓 `jenkins-ci` 技能移除前的逐节对比反馈，加上 2026-11-25 在内网 Jenkins 上真实跑通 GitLab→Jenkins→DooD 构建→部署全链路期间的 4 起可归因事故。全部内容有实战事故支撑，不补齐随 `jenkins-ci` 移除即彻底丢失。

### 变更（P0，全部有真实事故支撑）

- **REST 写操作 403 三坑写全（`references/troubleshooting.md` §4.1 + §1 症状行改指向）**——报错文案 `No valid crumb` 会把排查带偏到 crumb 上：① POST `/scriptText`、`/config.xml` 等写操作**即使带 cookie+crumb 头仍必须带 basic auth**（`-u user:pass`），缺一依旧 403；② crumb 从 `/crumbIssuer/api/xml` 原始 XML 用正则 `<crumb>([^<]+)</crumb>` 提取（Jenkins 默认安全策略禁用 xpath 的 `concat()`，照网上文档用 xpath 必失败）；③ PowerShell `Invoke-WebRequest` 内网 HTTP basic auth 必须加 `-AllowUnencryptedAuthentication`，crumb 与 session 复用同一个 `WebRequestSession`。
- **Script Console 执行 shell 的唯一可靠模板（§4.2）**——`ProcessBuilder` + `redirectErrorStream(true)` + `waitFor()`；配套两条：`p.text + p.err.text` 在 `waitFor()` 后读流必抛 `Stream closed`；Groovy 双引号里的 `$` 必须转义或换单引号（否则被当 Groovy 插值，静默改写命令语义）。容器化 Jenkins 无 CLI/无 SSH 时这是唯一命令通道。
- **「构建卡住但没报错」的判据与介入时机（§2）**——卡死与失败不同，没有报错就没有排障入口：① 每步骤记基线时长，轮询**远超基线必须主动介入，禁止盲等**；② 定位三板斧 `docker top` → `netstat/ss` 看对端 → 对端零进展 = 上游 registry/网络挂起，不是代码问题；③ 反证法：同代码上次构建正常 ⇒ 立即排除本次改动。
- **触发构建的幂等纪律（§3）**——POST 返回空/异常 exit ≠ 未入队；触发后先查 `lastBuild/api/json` 的 `number` 是否已 +1 再决定重试。冗余构建会与卡死构建互相污染因果证据链。
- **Deploy 段必须更新正式服务 + 部署后冒烟（`references/pipeline-authoring.md` §2）**——模板补 `curl -fsS --max-time 5` 冒烟示例与两条硬规则：目标必须是正式服务（只重建预览容器 = 构建 SUCCESS 用户看的还是旧版）；构建成功 ≠ 功能可用（dev-only 中间件没挂进生产，全绿但接口 404），冒烟失败让流水线失败。

### 变更（P1）

- **排障表补 2 行（`references/dood-and-gitlab.md` + §1）**：裸 `docker run` 调试报 sock `permission denied` → 补 `--group-add <gid>`；「新手入门引导页」行补备选方案「重打镜像让 InstallState 从根上跳过」。
- **边界声明核实（P1-2 选项①）**：确认 `jenkins-controller` 技能已收录控制器部署包内容（`test-190/jenkins`、镜像构成、端口、`DOCKER_GID` 核对、时区挂载），边界声明保留不动。
- **`SKILL.md` 增「0 快路径」表、「4 排障入口」表与「6 参考」精选外链**（Pipeline 语法/最佳实践、插件文档、DooD 权限社区帖、GitLab↔Jenkins 集成、实战 Jenkinsfile 合集）。

### 已知限制

- 实战案例里的内网地址已泛化（不落具体 IP）；`jenkins-controller` 的安装仍走仓库安装命令，老机器若只装了 `jenkins-cli`，控制器内容需补装该技能。

## 0.10.2

> **这一版把 phase 05 的「全仓 harness 门禁闭环」并进来** —— 兄弟会话那轮的 6 个提交（统一 harness 门禁 + 共享标准配置 `scripts/gates/standards.json` + 逐路径回滚锚点 + 三个技能修合规 + 新技能 `vibe-coding-standards`）与 main 的 0.10.1（可选依赖修复 + 协议栈门禁按官方依据收窄）**合并成一次发布**。
> 版本号取 **0.10.2**：0.10.0 / 0.10.1 都已发布且内容与合并后不同 ⇒ 必须新号。

### 合并说明

- **冲突处理**：`check-no-handrolled-protocol.mjs` / `protocol-allowlist.txt` / `vscode-backend/SKILL.md` 取 main 的新版本（另一分支上还是旧版）；CHANGELOG 两侧条目都保留；版本 0.10.1 → **0.10.2**。

### 已知限制

- 不变：`vscode-jsonrpc` 是**可选依赖**（离线机器装不上它时只有抽方法这条路缺席）；协议栈门禁是**文本粗筛**，协议合规以官方 conformance / Inspector 为准。

## 0.10.1

> **这一版把 0.10.0 里那套「手写协议栈」门禁按官方依据收窄** —— 0.10.0 发的是**粗版指纹**（会误伤正常调用代码），本版修掉，并把「官方依据」与「本门禁只是粗筛」写进代码注释，别把自建粗筛说成官方门禁。

### 变更

- **门禁指纹收窄（`scripts/check-no-handrolled-protocol.mjs`）**
  - ① 手工构造 JSON-RPC 报文：改成**同一行里既有 `jsonrpc` 又有 `method`/`id`** 才命中 ⇒ 只命中"手工构造请求"，不再误伤"用 SDK 但自己拼 payload"的正常代码；
  - ② 补上 MCP 侧：MCP 的 stdio framing 官方定义是**换行分隔**、**没有 `Content-Length`**（规范 2025-06-18 transports）⇒ 只盯 `Content-Length` 会漏掉 MCP 的手写接线；
  - ③ LSP 帧头仍抓 `"Content-Length: " + n` 这种引号里带冒号的写法，HTTP 的 `send_header("Content-Length", x)`（逗号）不误伤。
- **补官方依据与官方验证路线（代码注释 + `vscode-backend/SKILL.md`）**
  - MCP 官方："Build MCP servers and clients using our **official SDKs**"、架构文档 "MCP SDKs **abstract away many concerns**"、build-server 文档指出**手写接线只能服务老协议版本**（版本协商由 SDK 负责）⇒ 用 SDK 有官方依据，不只是风格问题；
  - **行为层官方验证**：`npx @modelcontextprotocol/conformance client --scenario initialize`、`npx @modelcontextprotocol/inspector --cli <启动命令> --method tools/list`；
  - 官方**没有**"检测手写协议栈"的 lint 规则（semgrep 全量 6308 条里 MCP 相关 168 条全是安全类）⇒ **本仓门禁只是文本粗筛**，协议合规以 conformance / Inspector 为准（这话写进代码注释）。
- **`vscode-backend/SKILL.md` 增「怎么测 VS Code 侧能力」现成轮子对照表** —— MCP→Python MCP SDK / LSP→官方 `vscode-jsonrpc` / 引用改名→agent-lsp / 符号图→codegraph / lint→`ruff --output-format=json` / 重复→jscpd / 全项目清单→vsc-lsp-mcp 的 `workspace_diagnostics`；并写明一次性探针脚本放 `.tmp/` 或 Temp 且**任务结束前删掉**。

### 已知限制

- 本仓门禁是**文本粗筛**，不是协议合规判定；真正的合规验证走官方 conformance / Inspector。
## 0.10.0

> **这一版做两件事**：① **全仓 harness 门禁闭环** —— `npm run check` 一条命令机械判定全仓 skill 与规则文件是否合规（issue 自带 文件:行）、提交前自动拦截不合规改动、判定标准只剩一份 `scripts/gates/standards.json`；② **新技能 `vibe-coding-standards` 首次入库**，同时把多个技能的内容修到过门禁。

### 新增

- **统一门禁 `scripts/gates/`** —— `npm run check` 输出一份结构化 JSON 报告（stdout）：3 个检查器（skill 结构 / 规则文件行数 / 交叉引用）各自的退出码、每条问题带**文件:行**、通过清单；任一 error 整体退出码非 0。报告走 stdout 不落仓库。
- **判定标准单一来源 `scripts/gates/standards.json`** —— AGENTS.md / Rule / SKILL.md / Subagent 按组件分档（200/120/150/200，references 300），三个检查器从同一份配置读阈值；改一个数字三处同步。SKILL.md 行数口径统一为**正文、不含 frontmatter**。
- **提交前拦截** —— `core.hooksPath` 指向 `scripts/gates`，pre-commit 调 `npm run check`：不合规的改动提交不进去（不引入 husky / lint-staged 等任何新依赖）。`scripts/gates/install-hooks.mjs --restore` 可按留证恢复原 hook 配置。
- **回滚锚点登记 `scripts/gates/ROLLBACK.md`** —— phase 内每个被改路径都有写下来的改造前锚点（commit / ref / 删除三型）与恢复命令。
- **新技能 `vibe-coding-standards`** —— Vibe Coding 核心组件（AGENTS.md / Rules / Skills / Subagents）的编写原则：地图内联防迷路、规范指针防上下文击穿、5 Pillar context engineering。
- **skill-creator-v2 增强** —— 校验 issue 自带 `file`/`line`（指向真正的问题位置）；引用存在性只认 markdown 链接（代码块里的模板路径不再误报）；`evals/` 新增 3 条机判回归用例与 `run-evals.mjs` 执行入口。

### 变更

- **死引用检查器升级** —— 能抓 markdown 链接形式的坏路径（原先只扫反引号 token，链接里的死链全漏）；样本集从 2 个文件扩到 78 个（`skills/*/SKILL.md` 与 `skills/*/references/*.md`）；git rev range（如 `origin/main..HEAD`）与运行时路径不再误判。
- **多个技能内容合规化** —— `vibe-coding-standards` 21 处旧体积口径换成标准真值、正文瘦身（160→141 行）、5 处死链接改纯文本；`session-distiller` 正文 341→144 行（内容搬进 references 不删）；`website-helper-skill` 正文 157→149 行 + 死链改真；`idea-backend` 一处死链改指现存文件。
- **npm 包新增两个技能** —— `session-distiller`（会话蒸馏器）与 `website-helper-skill`（子域名发布）首次进入发布包。

### 已知限制

- **`~/.agents/skills/` 里的旧副本不会自动更新** —— 重装覆盖：`npx holy-agents-kits@latest install <skill> --force`。
- **Windows 下 pre-commit 每次提交多花约 3 秒**（死引用检查器全量扫描 78 个文件）。
## 0.9.1

> **修一个会卡死离线用户的安装问题**:0.9.0 把 `vscode-jsonrpc` 写成了**硬依赖**
> (`dependencies`) ⇒ **离线机器装这个技能会直接装不上**(npm 装依赖失败即整包安装失败)
> ⇒ 一个新能力把老用户的安装卡死。0.9.1 改成**可选依赖**(`optionalDependencies`):
> 装不上不阻断整包安装,其余能力照常可用。

### 变更

- **`vscode-jsonrpc` 改可选依赖** —— 抽方法脚本缺依赖时不再崩在 import 上,而是打印**替代路线**
  并 **退出码 3**:改名走 vsc-lsp-mcp 的 rename 三段式 / agent-lsp 的 `rename_symbol`;
  抽方法走 IDEA 的 `ide_refactor_extract_method`
- `references/setup.md` §6.6 写明**技能目录里怎么装**这个可选依赖
  (`npm i vscode-jsonrpc --prefix ~/.agents/skills/vscode-backend`,离线加 `--offline`)

### 已知限制

- 抽方法这条路需要 `vscode-jsonrpc`;**离线且没装它**时该能力缺席(其余能力不受影响)

## 0.9.0

> **这一版做两件事**：① 把 0.8.0 里两条**被复测推翻的结论**改回来 —— 「VS Code 侧无抽方法」「诊断这条路 VS Code 侧没有腿」是**把一条腿的失败当成了能力不存在**；② **把三样 IDEA 级能力真正接通**（抽方法 / 全项目检视 / 全局改名落盘）。0.8.0 已发布不可重发，修正与新能力一起走本版。

### 新增（三样 IDEA 级能力，VS Code 侧全通）

- **全项目问题清单（= Inspect Code 等价）** —— 复用现成的 **vsc-lsp-mcp**（VS Code 扩展 `CJL.lsp-mcp`，MIT）：`execute_lsp{operation:"workspace_diagnostics"}` 底层就是 `vscode.languages.getDiagnostics()` 的无参重载（**Problems 面板的数据源**）⇒ 实测对坏文件返 **7 条** error（source=Pylance），与同版本 pyright CLI 的 7 条一致。
- **全局改名并落盘** —— 同一个扩展的 `prepare_rename` → `rename_preview` → `rename_apply`（VS Code 原生 rename provider，`applyEdit` + `save`）⇒ 实测改一个方法名 **4 个文件 / 8 处**全部落盘，`savedToDisk: true`。
- **抽方法并落盘（TS/JS）** —— 仓内新脚本 `skills/vscode-backend/scripts/lsp-refactor.mjs`：TS 的「Extract to function」是 **command 型** code action（`_typescript.applyRefactoring`，不带 edit）⇒ 凡是「只收 edit 型动作」的 MCP（BifrostMCP / vsc-lsp-mcp / agent-lsp）都给不了它，只能直连；脚本用**微软官方 `vscode-jsonrpc`**（不自造协议栈）⇒ 实测一次返 **4 个** action，执行后**落盘成功**（语句抽成新函数、原处换成调用）。
- **新增可选依赖**：`vscode-jsonrpc`（MIT、零依赖）—— 只给上面那个脚本用。**是 `optionalDependencies` 不是 `dependencies`**：离线机器装不上它时本仓其余能力照常可用，只有抽方法这条路缺席（脚本退出码 3 并给出替代路线）⇒ 不让一个新能力把离线用户的安装卡死。

### 变更

- **选型决策表三行改口径**（`skills/vscode-backend/references/runtime.md` §8 与 `skills/idea-backend/references/capability-matrix.md` §7 **逐字同源**，两份都改了）：
  - **抽方法 / Extract Method** —— 原文写「VS Code 侧无此能力（实现层）」，**错**：该结论来自 agent-lsp `refactor` 工具的一次失败（一个位置 30s 超时、另一个位置直接崩 tsserver）。**2026-11-23 直连 `typescript-language-server` 的 `textDocument/codeAction`(kind=refactor) 实测返 4 个抽方法 action**（`refactor.extract.function` ×2 / `refactor.extract.constant` / `refactor.move.newFile`），每个 action 自带 `_typescript.applyRefactoring` 命令可落盘 ⇒ **VS Code 侧有抽方法，缺的是腿的封装、不是能力**；本机 Python 侧（pyright）不声明 refactor ⇒ 实测 0 个（VS Code + Pylance 有，未在本机实测）。推荐主备也据此调整：TS 走 VS Code 侧直连，JVM / Python 走 IDEA。
  - **全项目规范审查 / Inspect Code** —— 原文写「协议层没有 scope 级检视」，**归因不准**：inspection + scope + 批量修复这套语义 LSP **从未定义**（结论不变），但诊断侧的工作区级请求 `workspace/diagnostic`（LSP 3.17）**协议层存在、实现缺席**（实测 TS 腿 `-32601`、Python 腿超时）⇒ 是「协议有、实现缺席」，不是「协议没有」；VS Code 的 Problems 面板是**客户端聚合** push 诊断的结果，agent 走 MCP 拿不到。
  - **单文件诊断** —— 原文写「VS Code 侧诊断这条路没有腿」，**只对 TS 腿成立**：**Python 腿直连 pyright 的 LSP 3.17 `textDocument/diagnostic` 实测坏文件返 7 条、与同版本 pyright CLI 同数** ⇒ agent-lsp 的 `get_diagnostics` 恒 0 是**那条封装坏了**。TS 腿仍拿不到诊断（两条 MCP 腿 + 直连都不通）⇒ 走 `tsc --noEmit`。
- **新增两条实测凭证 + 四行档位**（`references/measurements/typescript.json`、`references/tiers.md`）：实测 `L5-extract@typescript-ls`（4 个 action）、`L3-pull@pyright`（7 条）；缺口 `L5-extract@pyright`、`L3-pull@typescript-ls`。
- **`vscode-backend` 的 SKILL.md / `setup.md` / `reuse-survey.md` 同步改口径**，并新增 **§6.6「抽方法与诊断怎么走（直连 LSP 那条路，不经 MCP）」** 与 SKILL 里的**第④条腿**（直连语言服务器）。
- **BifrostMCP `get_code_actions` 报 `Illegal argument` 的根因定位**：扩展把 `position` 缺省成 `undefined` 传给 `vscode.executeCodeActionProvider`，而它的 `rangeOrSelection` 参数**必填** ⇒ **补上 position 就能拿到动作列表**（但扩展不返回 edit，落盘仍要直连路）。

### 已知限制

- **Python 侧的抽方法仍然没有腿** —— 本机 pyright 腿实测 0 个（不声明 refactor）；VS Code + Pylance 有 Extract method，但它是 command 型、只活在编辑器里 ⇒ agent 侧要抽方法只能回 IDEA（`ide_refactor_extract_method`）。Pylance 那条路**未在本机实测**。
- **TS 腿的单文件诊断仍然没有路** —— 直连 `typescript-language-server` 既不实现 pull 诊断（`-32601`）也不推 `publishDiagnostics` ⇒ 只能走 `tsc --noEmit` / ESLint（**工作区级清单**走 vsc-lsp-mcp 的 `workspace_diagnostics` 是通的）。
- **工作区级清单只含 VS Code 已分析过的文件** —— 干净仓首次可能为空 ⇒ 先打开文件或等后台分析。
- **vsc-lsp-mcp 的 `code_actions` 在 TS 上会 ENOENT**（VS Code 的 TS 扩展列 refactor 时去 stat「同名符号.ts」）⇒ 抽方法别走它（它的 `workspace_diagnostics` 与 rename 三段式不受影响）。
- **抽方法落盘的四个硬规矩**（写进 `references/setup.md` §6.6）：选区要盖住整条语句并越过结尾一列；工程根取最近的 `tsconfig.json` 祖先目录；客户端必须接住 `workspace/applyEdit` 与 `_typescript.rename` 两个反向请求；CRLF 文件会被插入 LF 行（内容对但变混合换行）⇒ 仓库统一 LF。

## 0.8.0

### 新增

- **`vscode-backend`（新技能）** —— 把 VS Code 与语言服务器当 agent 的语义后端，两条腿并行用：
  - **窗口开着时**借 VS Code 自己的能力（BifrostMCP 扩展的原生 MCP 通道：定义 / 引用 / 工作区符号 / 文档符号 / 语义 token）；
  - **窗口关着也能查**（agent-lsp 直跑语言服务器：引用 / 单文件诊断 / 改名删除前的影响面）；
  - 另加**跨语言代码图**（codegraph）作第三条腿。
  - 能力按 **L0-L5 档位逐格实测**，每个数字都能回查到凭证；没有的能力写清「无此能力 + 可核对的来源」。
- **`idea-backend` 新增跨后端选型决策表**（`references/capability-matrix.md` §7，**14 行**）—— 任务类型 × 语言 → 推荐后端 / 依据 / 证据等级 / 代价与前提 / 何时别选它。同一份表在 `vscode-backend` 的 `references/runtime.md` §8 有一份**逐字同源**的副本（两个技能各自独立分发，各带一份）。
- **`idea-backend` 新增实测数据表**（`skills/idea-backend/fixtures/experiment/results.md`）—— **24 格**对照实验（6 个任务 × 4 种配置的逐格数据：召回 / 精度 / 耗时 / 载荷字节 / 失败模式）。

### 变更

- **旧的选型表与比例阈值作废** —— `idea-backend/references/semantic-backend-options.md` 的 §4 旧选型表与 §5 比例阈值（完成率 ≥95%、recall ≥0.9 等）**已作废**，由上面的跨后端选型决策表接管。作废标记在文件里就写着，别再照旧表选型。

### 实测不可用的能力（这一期**别按想象用**）

| 能力 | 实测结论 |
|---|---|
| **VS Code 侧抽方法（Extract Method）** | **不通**。agent-lsp 的 `refactor` 在 tsserver 侧走 `textDocument/codeAction`：一个位置 **30s 超时**，另一个位置直接**崩 tsserver**（`Cannot read properties of undefined (reading 'kind')`）⇒ VS Code 侧无此能力。IDEA 侧有 `ide_refactor_extract_method`，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它）。 |
| **全项目规范审查（Inspect Code）** | **只有 IDEA 有**（`ide_inspect` 按 scope 批检视 = L4，同样需 monster 分支）。这是**协议层缺口**：LSP 的 `textDocument/codeAction` 没有 scope 参数，VS Code 侧 **19 个工具面**里也没有对应工具 ⇒ VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）自己汇总。 |
| **BifrostMCP 的 `get_code_actions`** | **坏的**（扩展 0.0.14 实测报 `Illegal argument`）⇒ VS Code 侧的诊断入口取不到东西。 |
| **agent-lsp 的 `get_diagnostics`（TS 腿）** | **恒返 0 条**（静默失效）。实测：daemon 预热 **130s** 后仍返 0 条，先 `open_document` 也一样；同会话 `list_symbols` 能解析该文件 ⇒ 排除「索引未就绪」；而**同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错** ⇒ **0 条 ≠ 文件干净**。单文件诊断耗时约 **25s**（一次 25011.4ms）。 |

⇒ 结论：**单文件诊断这条路，VS Code 侧本轮没有能用的腿** —— 只剩 IDEA 腿与外部 linter（pyright CLI / ruff）。

### 已知限制（读文档前先知道）

- **两处 reference 较长** —— `skills/vscode-backend/references/runtime.md`（约 620 行）与 `skills/idea-backend/references/capability-matrix.md`（约 730 行）：**决策表在各文件的 §8 / §7（第 90 行上下）**，读完表即可停；其后的数百行是**机器可读块**（JSON），供仓内对账门禁逐格核对用的。拆成独立 json 归后续（要改门禁契约 + 重验）。
- **改名只验到干跑** —— 全局改名的实测全程 `dry_run`（预览覆盖 247 文件 / 740 处），**落盘**的端到端没做过。
- **只覆盖 Python 与 TypeScript 的同题对照** —— JVM / Rust 侧是单边腿既有实测，本期没做同题对照。

### 怎么用（三条腿各自装什么）

| 腿 | 装什么 | 怎么调 | 代价 |
|---|---|---|---|
| **① VS Code 自己的能力**（BifrostMCP） | `code --install-extension ConnorHallman.bifrost-mcp`；再 `bash skills/vscode-backend/scripts/install-vscode-mcp.sh <工作区路径>` | 工程根 `.mcp.json` 指 `type:"sse"` ⇒ 宿主自带 MCP 客户端直接用 | **窗口必须常开**；诊断与改名两个工具在 0.0.14 实测是坏的 |
| **② 窗口外的语义后端**（agent-lsp） | `npm install -g @blackwell-systems/agent-lsp` + `npm install -g typescript-language-server` + 全局 `typescript@5` | `.mcp.json` 指 `{"command":"agent-lsp","args":["typescript:typescript-language-server,--stdio"]}` ⇒ MCP stdio | **server spec 必须带 `,--stdio`**（少了它 broker 自杀，报 `daemon: broker did not start`，而 `agent-lsp doctor` 报 ok 测不出这个坑）；诊断单文件 25s、影响面 19s |
| **③ 跨语言代码图**（codegraph） | `npm install -g @colbymchenry/codegraph` | MCP 工具查符号与影响面 | 本技能**未测**它的档位 |

装技能本身：

```bash
npx holy-agents-kits install vscode-backend   # VS Code / 语言服务器那条线
npx holy-agents-kits install idea-backend     # IDEA 那条线
```

两条线**互不依赖** —— 按上表的选型决策表挑后端即可（IDEA 侧的工具面以 `bash scripts/mcp-call.sh list index` 实测为准，不以文档为准）。
