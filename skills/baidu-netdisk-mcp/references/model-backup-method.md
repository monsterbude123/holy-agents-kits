# 模型备份方法（我们自己的做法）

把本机模型库加密压缩后备份到百度网盘。脚本：`../scripts/model-backup.mjs`。

## 总览

```
选模型 → 收集同名附件 → zip 加密打包 → 上传网盘 → 写台账
        pick        pack              upload        ledger
```

一次备份 = 一个模型 + 它的全部同名附件，打进**一个**加密 zip。

## 附件判定

模型本体之外的附属文件，**同目录 + 同名**才一起打包：

| 模型本体 | 一起打包的附件 |
|---|---|
| `X.safetensors` | `X.cm-info.json`（civitai 元信息）、`X.preview.jpeg`（预览图）、`X.civitai.json`、`X.yaml`/`X.txt`（说明） |

实现：先剥掉文件名里的标记后缀（`.cm-info` / `.preview` / `.civitai` / `.info` / `.metadata`）
和扩展名，得到 **模型 key**；同目录下 key 相同的即归属该模型。

排除：`.` 开头的隐藏文件、`*.tmp.part0`（未下完的残片）、`.metadata-only/` 目录。

## 目录与命名约定

| 用途 | 位置 |
|---|---|
| 备份包暂存 | `<暂存目录>/`（默认 `~/.model-backup-packs`，可用 `MODEL_BACKUP_WORK` 覆盖） |
| 台账 | 同目录 `ledger.jsonl`，每行一条 JSON |
| 网盘目标 | `/apps/bdpan/model-backup/<归档名>.zip` |

**归档名必须 ASCII**：`asciiName(原名)` = 可读部分 + 原名 sha1 前 8 位，
例如 `<模型名>.safetensors` → `6000.safetensors_67908568.zip`。
中文原名与每个文件的 sha256 记在**包内 `manifest.json`** 和台账里。

## 密码

默认 `ai123456`（`MODEL_BACKUP_PASSWORD` 可覆盖）。

> ⚠️ **公开仓里写明默认口令等于弱口令实践** —— 备份包一旦泄露，口令是公开的。
> 实际使用请用 `MODEL_BACKUP_PASSWORD` 注入强口令，或按项目改一个；本文档里的默认值只是示例。
用的是 Info-ZIP 的 ZipCrypto（`zip -P`）—— 通用、任何 unzip 都能解，但强度弱于 AES-256。
要更强就换 7z/AES，但那样就不是通用 zip 了。

## 命令

```bash
SK="${BAIDU_SKILL_DIR:-$HOME/.agents/skills/baidu-netdisk-mcp}"   # 技能安装目录
ROOT="<模型库根目录>"                                              # 或 export MODEL_BACKUP_ROOT=...
WORK="<暂存目录>"                                                  # 或 export MODEL_BACKUP_WORK=...

# 看会打包哪些（模型 + 同名附件）
node "$SK/scripts/model-backup.mjs" pick --root="$ROOT/models" --include=loras --limit=5

# 打包（加密）
node "$SK/scripts/model-backup.mjs" pack --root="$ROOT/models" --include=loras --limit=2

# 校验（正确密码 exit=0；错误密码 exit=82 incorrect password）
node "$SK/scripts/model-backup.mjs" verify --pack=<包.zip> --password=<密码>

# 还原（解压 → 按 manifest 还原原始文件名 → 逐个 sha256 校验）
node "$SK/scripts/model-backup.mjs" restore --pack=<包.zip> --to=<还原目录> --password=<密码>

# 上传（只允许 /apps/bdpan/ 下）+ 回写台账
node "$SK/scripts/model-backup.mjs" upload --pack=<包.zip> --remote=/apps/bdpan/model-backup/x.zip

# 台账
node "$SK/scripts/model-backup.mjs" ledger --dir="$WORK"
```

通用开关：`--dry-run`（只演练不写）、`--json`（stdout 单行 JSON 信封）。

## 包内结构

```
manifest.json      原名映射 + sha256 + 原目录（UTF-8 JSON）
model.safetensors  模型本体
model.json         附件（按扩展名命名，重名加序号）
model.jpeg         附件
```

包内**一律 ASCII 名**：Info-ZIP 的 Windows（GnuWin32）构建是 ANSI 编译，
中文名会被存成 `#U95ea#U4eae...` 转义，跨机器还原就废了。
还原时由 `manifest.json` 把 ASCII 暂存名换回原始名。

## 前置依赖

| 依赖 | Windows | Linux/macOS |
|---|---|---|
| zip / unzip | GnuWin32 版（`winget install GnuWin32.Zip`；`unzip` Git Bash 自带） | 系统自带 |
| bdpan CLI | `bdpan-storage` skill 的 `scripts/install.sh`（需 ≥ 3.9.0） | 同 |

`zip.exe` 依赖同目录的 `zip32z64.dll`，**必须从 GnuWin32 安装目录启动**；
脚本因此用 `resolveBin()` 指向真实 `.exe`，而不是 PATH 里的 shell 包装脚本。

想在自己 shell 里直接用 `zip`，放一个包装脚本到 `~/.local/bin/zip`（注意 Node 的
`spawnSync` **不走 shell**，执行不了这种无扩展名的包装脚本，脚本内部才用 `resolveBin()` 绕开）：

```sh
#!/bin/sh
# 安装根从环境变量取，不写死盘符。
# 注意 ${ProgramFiles(x86)} 在 bash 里是坏替换（变量名不能带括号），用 printenv 取。
exec "$(cygpath -u "$(printenv 'ProgramFiles(x86)')")/GnuWin32/bin/zip.exe" "$@"
```

## 踩过的坑

- **`zip -mhe=on` 不支持 zip 格式**（只有 7z 支持），一用就 exit=2 fatal error。
  想加密文件名头就得用 7z 格式，那就不是通用 zip 了。
- **zip 遇到缺失文件只 warning、退出码仍是 0**，不能只看退出码判成败；
  脚本失败时会再跑一次不加 `-q` 的，把真实报错抓出来。
- **Node 的 `spawnSync` 不走 shell**，PATH 里的 shell 包装脚本（`~/.local/bin/zip`）
  会被 ENOENT；且 spawn 失败时错误在 `r.error` 而不在 `r.stderr`，不显式抛出就变成空报错。
- **GnuWin32 版 zip 处理不了中文名**：实测中文名在包内变 `#Uxxxx` 转义（Info-ZIP 的
  UTF-8 转义约定）→ 所以包内一律用 ASCII 名。是否为 ANSI 编译未查到官方说明，
  但可观测后果一致：**不要把中文名放进包里**。
- **`file_meta`/`file_list` 对目录的 size 恒为 0** → 目录体积要用网盘的 `dirsize` 接口，
  别自己枚举文件累加（深层树上少算一半）。见 `dirsize.md`。
- bdpan 只能操作 `/apps/bdpan/` 目录；命令必须带
  `--agentname / --session-id / --auth-flow cli / --skill-name baidu-drive / --skill-version`。

## 还原流程（灾备）

```bash
# 1. 从网盘下载（远端路径 → 本地）
bdpan download /apps/bdpan/model-backup/<包>.zip ./restore/

# 2. 解密解压 + 还原原名 + 校验
node scripts/model-backup.mjs restore --pack=./restore/<包>.zip --to=./out --password=ai123456

# 3. 需要的话把模型本体放回原目录
node scripts/model-backup.mjs restore --pack=... --to=... --to-original
```
