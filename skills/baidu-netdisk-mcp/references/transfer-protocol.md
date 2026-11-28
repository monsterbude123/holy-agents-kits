# 传输协议与实测边界（上传 / 下载 / 哈希）

> 本文只写**实测过的**东西。每条都有复现依据；没验过的写「未确认」。
> 数字是单账号单网络的实测先验，**仅作量级参考**。

## 一、传输通道：能用的是什么

| 通道 | 状态 | 证据 |
|---|---|---|
| **openapi 原生分片协议** | ✅ **可用** | `precreate` / `superfile2` / `create` 三步全通，见下 |
| openapi 单步上传 `xpan/file?method=upload` | ❌ 403 | `file is not authorized`；换 5 个 `app_id` 全 403 |
| openapi `xpan/multimedia?method=precreate` | ❌ | `unsupported api` |
| PCS `superfile2?method=precreate`（pcs.baidu.com 主机） | ❌ | HTTP 500 `internal error` |
| bdpan CLI | ⚠️ 能传但是黑盒 | 见第五节 |

**别被 403 误导成「这个 token 不能上传」** —— 单步上传被拒，**原生分片协议是通的**。

## 二、上传协议（三段式）

来源：百度官方 Go SDK `icode.baidu.com/baidu/xpan/go-sdk` 的 `uploadsdk/upload`
（precreate / upload / create 三件套）+ 成熟实现 `trying2016/mopler` 的 `impl/upload/upload.go`。

```
① 预上传  POST https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=…
   form: path, size, block_list(JSON数组=每片md5), isdir=0, autoinit=1, rtype=2
         续传时额外带 uploadid
   resp: errno, uploadid, return_type, path,
         block_list([]int ← **需要上传的分片序号，索引从 0 开始**)

② 分片    POST https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload&access_token=…
   query: type=tmpfile, path, uploadid, partseq=N
   body: multipart/form-data，字段名 file，内容是**该片字节**
   resp: md5（= 该片的标准 md5）, request_id

③ 建档    POST https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=…
   form: path, size, isdir=0, block_list, uploadid, rtype=2
   resp: errno, path, fs_id, md_5（← 网盘侧那个**闭源变种** md5 的出处）
```

### 作用范围：原生协议能写整个网盘（不像 bdpan CLI）

实测 `precreate` / `superfile2` / `create` 三步对 `/99_索引/` 和 `/apps/bdpan/` **一视同仁**：
都能建档成功。bdpan CLI 只能碰 `/apps/bdpan/`，那是 **CLI 的范围限制，不是 API 的**。

所以 `transfer.mjs` 的远端路径只要求「是网盘绝对路径（以 / 开头、不含 ..）」，
不强制 `/apps/bdpan/` 开头。想只在应用数据区里传，自己给 `--remote=/apps/bdpan/...` 即可。

### 切片大小按会员等级限制

`普通 4MB / 会员 16MB / 超级会员 32MB` —— 这三个值来自官方 SDK 与成熟实现的注释。
**本账号（SVIP）实测：4MB ✅ / 16MB ✅ / 32MB ✅ 三档都能传**（16MB 档实测 40MB 文件 3/3 片、
远端大小核对通过）。**普通账号（4MB 档上限）没条件验**。

`block_list` 的 md5 必须与你**实际传的那片**一一对应 —— 自己按 4MB 切、
却提交 16MB 切片的 md5，服务端会拒收。
所以脚本**只接受这三个值**，别的直接报错（早失败好过传到一半被拒）。

### 续传是服务端驱动的

不是我们本地猜的：**precreate 时带上已有 `uploadid`，服务端会认出已传的片，
只回缺的那几个**。

实测：10 片的文件传到第 3 片被杀 → 重跑 → 服务端回 `block_list:[1,2]`（只缺 2 片），
进度条从 40% 起步，8.5s 完成（全量要 14s）。

### 续传的前提：本地文件不能变

状态文件里记着 `uploadid` + 已传片 + **文件 sha256**。重跑时若 sha256 对不上
（文件被重新生成 / 被别的进程替换），**必须放弃旧状态、从头来** ——
否则服务端留着旧内容的头几片、我们再补新内容的后几片，
网盘上就是一份**拼接出来的损坏文件**，而台账里记的 sha256 是新文件的，对不上也查不出来。

### 秒传：用不了（实测）

官方 SDK 的 precreate 还带 `content-md5` / `slice-md5` 两个参数，就是为秒传准备的。
实测把它们带上，返回与不带**完全一样**（`block_list` 不变、`return_type` 不变）——**秒传没触发**。

原因与第四节是同一件事：秒传的键空间是百度**自己那套闭源 md5**，我们本地算的标准 md5
对不上，所以服务端认不出「这份内容我已经有」。

`precreate` 的 `return_type` 是服务端状态字段（官方 SDK 只注释「系统内部状态字段」，
**具体取值语义未确认**）。实测正常上传也返回 `return_type:1`，别据此判断是否秒传。

**代价**：同一份内容重复上传会**真传一遍**（不走秒传）。
省这遍的办法在**下载侧**：台账里有 sha256，先查远端大小+sha256 对不对，对了就跳过。

## 三、下载协议

```
① 取链接  GET https://pan.baidu.com/rest/2.0/xpan/file?method=filemetas
            &fsids=[<fsid>]&dlink=1&access_token=…
   resp: info[0].dlink（含 sign，expires=8h）、size、md5
② 下载    GET <dlink>&access_token=…
   resp: 文件流；HEAD 返回 accept-ranges: bytes；Range 请求返回 206 Partial Content
```

**两个坑**：

1. **dlink 必须自带 `access_token`**，否则 403 `{"error_code":31045,"error_msg":"user not exists"}`。
   —— 看起来像 UA 问题（试过 5 种 UA 全 403），其实是缺参数。
2. 取 dlink 用 **`xpan/file`**（返回结构是 `info[]`），不是 `xpan/multimedia`（返回 `list[]`）。

**Range 可用 ⇒ 下载断点续传可行**：本地留 `.part`，续传时带 `Range: bytes=<已有>-`。

## 四、哈希口径：两级，各司其职

| 层级 | 用什么 | 为什么 |
|---|---|---|
| **片级** | **标准 md5** | 百度 `block_list` 协议就是这个，服务端逐片校验，**必须是标准 md5** |
| **文件级（我们的账本）** | **sha256** | 我们自己的真值，写进台账，下载后逐文件比对 |
| **网盘返回的 md5** | 闭源变种 | **只作网盘侧身份标识**（跨副本去重），**不参与本地校验** |

### 网盘 md5 为什么不能当尺子

实测同一份文件：

```
本地 md5 : 071c4252977ad3eaa29d87ba7e98fe6b
网盘 md5 : 937252398l7aa352d1c9d628ba08314c     ← 还含非十六进制字符 l
```

长度都是 32、格式像 md5，但**内容不同**。又用 20+ 种常见变换去反推
（字节序全反 / 每 4 字节组反 / 4-8-16-64 字节块反 / md5(hex串) / md5(raw) /
分片 md5 串 / 前 64KB-4MB 截断 / sha1 前 16 / sha256 前 16 / 拼 size …），
**没有一种能命中**（4 组配对要求同时命中）。

结论：百度那套是**闭源专有哈希**，本地复现不出来 → **别拿它做本地校验**。

## 五、bdpan CLI 的实测边界（为什么不用它当主通道）

| 事实 | 证据 |
|---|---|
| **内部就是切片上传** | 报错原文：`scene: slice upload part 3: upload slice: errno=31024 msg=app id is empty` |
| **不吐任何进度** | stderr 只有「正在上传 X → Y …」+ 完成链接；无 `--verbose/--progress`，无调试 env |
| **远端上传期间不可见** | 30s 上传全程轮询远端大小**恒为 0**，传完才原子出现 → 轮询拿不到字节级进度 |
| **无断点续传** | 传到 6s 强杀 → 远端无残留，重跑 34s ≈ 从头来 |
| **下载有真进度** | 写 `<name>.part` 边下边长（t=3s 81KB → t=6s 96.5MB → t=9s 改名完成） |
| **下载也无续传** | 强杀后无 `.part` 残留，重跑从头 |
| **同名同内容 → 自动复用** | 输出「同路径文件已复用，未生成副本」 |
| **同名不同内容 → 静默重命名** `x(1).bin` | 传 v2 后远端仍是 v1 → **同步陷阱**，要真覆盖必须 `--overwrite` |
| **瞬时故障，报错误导** | 100MB 首次失败 errno 31024，重试成功 → 上传必须带重试 |

**结论**：bdpan 适合「传一个文件、拿到链接」，不适合当「可观测、可续传的传输层」。

## 六、大文件实测

| 用例 | 结果 |
|---|---|
| 2.3 GB / 144 片 × 16MB 上传 | ✅ 473 s，平均 **4.9 MB/s**，远端大小核对通过 |
| 2.3 GB 稀疏文件的分片偏移逐片对拍 | ✅ 144 片 **0 处错位**（2GB 边界上的偏移正确） |
| **2.3 GB 完整回环**（上传→下载→比对） | ✅ 下载 82.1 s / **28.1 MB/s**，sha256 一致，`cmp` 逐字节一致 |
| 20 MB / 40 MB / 178 MB 上传 | ✅ 全通过 |

> 切片越大越快：4MB 切片约 2.8 MB/s，32MB 切片约 4.8 MB/s（HTTP 请求开销被摊薄）。

## 七、速度基线（单账号单网络实测，仅作量级参考）

| 场景 | 实测 |
|---|---|
| 上传 4MB 切片 | ~2.8 MB/s |
| 上传 32MB 切片 | ~4.8 MB/s（**切片越大越快**：HTTP 请求开销摊薄） |
| bdpan 上传 | ~2.5 MB/s |
| 原生下载 | ~11.5 MB/s（2.3GB 大文件实测 **28.1 MB/s**） |
| bdpan 下载 | ~14 MB/s |

## 八、脚本

```bash
SK="${BAIDU_SKILL_DIR:-$HOME/.agents/skills/baidu-netdisk-mcp}"

node "$SK/scripts/transfer.mjs" upload   --file=<本地> --remote=/apps/bdpan/x.zip [--slice=32MB]
node "$SK/scripts/transfer.mjs" download --remote=/apps/bdpan/x.zip --to=<本地> [--expect-sha256=<hex>]
node "$SK/scripts/transfer.mjs" hash     --file=<本地> [--slice=32MB]
node "$SK/scripts/transfer.mjs" ledger
```

- `--slice`：百度只认 4MB / 16MB / 32MB（按会员等级）。**不给 `--slice` 时按账号会员等级自动选**（探测失败回落 4MB）。**切片大小变了，已传的片就作废**。
- 续传状态默认落 `~/.baidu-transfer-state/`，可用 `--state-dir` 改。
- 传/下的台账（sha256、字节、速度、是否续传）在同一目录的 `ledger.jsonl`。
- 远端路径必须是**网盘绝对路径**（以 `/` 开头、不含 `..`）。原生协议能写整个网盘，
  不像 bdpan CLI 只能碰 `/apps/bdpan/`。

## 九、踩过的坑

- **单步上传 403 ≠ 不能上传** —— 换原生分片协议。
- **dlink 403 `user not exists`** —— 缺 `access_token`，不是 UA 问题。
- **errno 31024 `app id is empty`** —— 是**瞬时故障**的误导性报错，重试即可；别当参数错误去改代码。
- **同名不同内容会静默重命名** —— 更新已有文件必须显式覆盖，否则「同步」会变成「多一个副本」。
- **改了 `--slice` 就等于换了分片** —— 续传前别改切片大小。
- **网盘 md5 ≠ 标准 md5** —— 本地校验用自己的 sha256。
- **Git Bash 下跑这些脚本要 `export MSYS2_ARG_CONV_EXCL='*'`** —— 否则 `/apps/...` 被转成 Git 安装目录下的路径。
- **块内 `const` 别遮蔽外层同名变量** —— `const remote = await listDir(…, remote.slice(…))`
  会触发 TDZ，每次都抛 `ReferenceError` 再被 catch 吞掉，
  表现为「校验跳过」——**校验其实一次都没跑**（本仓真实踩过）。
- **openapi 调用要带超时** —— 服务端半死不活时 fetch 永不返回，
  CLI 就停在某个进度刻度上一动不动。脚本用 `AbortController` + ref 定时器自己控，
  **不用 `AbortSignal.timeout()`**（它不保活，顶层 await 里会让进程提前退出）。
