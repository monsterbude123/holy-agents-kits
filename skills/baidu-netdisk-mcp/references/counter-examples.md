# 反例：这次实际踩过的坑

每条都是真实发生过的错误做法 + 现象 + 正确做法 + 代价。
**先看这里再动手**，比读脚本源码省时间。

---

## A. 拿目录体积（最贵的一个错）

### ❌ 用枚举文件自己累加目录体积

```js
// 错：list / filemetas 对目录的 size 恒为 0，只能把子树文件逐个加起来
for (const f of listAll(dir)) bytes += f.size;
```

**现象**：一棵树枚举得 281.5 GB，网盘 UI 的官方数字是 **727.5 GB**——少了一半。
再往深处，误差更大。**根因**：文件藏在第 3~14 层，扫描撞到深度上限时底下根本没被列举，
于是所有体量数字都是**下界**，看起来「对不齐 15T」。

**✅ 正确**：用网盘自己的 `dirsize` 接口（口径与端点见本仓 references/dirsize.md）。
`path` 支持逗号分隔多目录，一批一次提交。

### ❌ `filemetas&dircache=1` 拿目录体积

**现象**：`{"size":0}`，无论加不加 `dircache`、`web=1`、还是先 list 预热缓存，全是 0。
openapi 就是不返回目录聚合体积，别在这上面耗时间。

### ❌ 提交了 dirsize 却取不到结果就反复重提交

**现象**：每次 `method=dirsize` 都返回**新 taskid**，不是复用缓存。
等 20s 再提交又是一个新 taskid，结果永远出不来。
**✅**：taskid 必须配 `taskQuery` 取；而 `taskQuery` 只在 web 端（要 BDUSS），
openapi 的 `xpan/multimedia?method=taskquery` 恒返回 `errno 1 服务器错误`。

### ❌ 猜接口名

**现象**：`method=stat` / `dirstat` / `count` / `taskquery`(on xpan/file) 全返回
`31296 internal error` 或 `31023 param error`，纯猜。
**✅**：去抓网盘自己的 JS bundle grep `dirsize` / `taskquery` —— 端点是**写死在里面**的：
`folderSize:"/mid_mucw/api/ostp/file/dirsize"`、`taskQuery:"/mid_mucw/api/ostp/file/taskQuery"`。

---

## B. 目录判定与分页

### ❌ `category === 6` 判目录

**现象**：`.safetensors` / `.7z` 的 `category` **也是 6**（与目录同值）。
把它当目录去 list（返回空），**900 GB 模型完全漏算**。

**✅**：`const isDir = (n) => Number(n.category) === 6 && !n.md5;`（目录 md5 为空，文件必有 md5）
openapi 的 `isdir` 字段是独立的，更可靠。

### ❌ 按 100 条判断「最后一页」

**现象**：网盘 `file_list` **每页只返回 10 条**。按 100 判断 → 每个目录只看到前 10 项 →
体积统计偏小、重复检测漏报（曾把两个各 93.6 GB 的重复树看成只有 74% 重合）。

**✅**：`if (items.length < 10) break;` 且必须翻到**空页**为止。

---

## C. 移动与建目录

### ❌ `make_dir` 用默认 rtype

**现象**：默认 `rtype=1`（冲突则重命名）。建 44 个目录 → 根目录多出 **44 个 `_时间戳` 空目录**；
而且 `file_move` 的 dest 必须是**字面路径**，重命名产生的 `xxx_时间戳` 不会被跟随。

**✅**：`make_dir` 一律显式传 `rtype: "0"`（冲突就返回冲突，不创建副本）。

### ❌ `file_move` 用 `async=1` 然后立刻校验

**现象**：`async=1` 只是**受理**，文件可能几分钟后才落地，`errno:0` **不代表搬成功**。
第一轮 43 项全部「OK」，实际源目录纹丝未动；重跑时源已被搬走 → `errno -9`。

**✅**：小批量 + `async=0` + **逐项解析 `info[]`**；遇 `-9` 回源/目标核对
（源真不在、目标已在 = 已完成，幂等）；超大目录（同步模式报 `-8`）单独 `async=1` 提交后轮询。

### ❌ 以为 MCP 没有删除能力

**现象**：`tools/list` 实际有 **26 个**工具，含 `file_delete`（入参 `filelist` 为路径字符串数组的 JSON 串）。
我因为没核对就写了「MCP 没有删除能力」，导致 skill 和网盘索引里的说明都是错的。

**✅**：动工具前先 `tools/list` 拉全量清单，别凭印象。

---


---

> **脚本与运行时**那一组（参数解析的 NaN、TDZ 遮蔽、MCP 返回格式、幂等回查、扫描剪枝…）
> 已拆到 [counter-examples-runtime.md](counter-examples-runtime.md)。

## E. Agent 用脚本的方式（这条最容易踩）

### ❌ 拿到技能先读脚本源码

**现象**：agent 看到正文里的命令不含可运行路径（或含 `<skill_dir>` 占位符），
第一反应是「读源码搞清楚参数怎么传」，而不是直接跑。

**✅**：正文里的命令**写成绝对路径、复制即可运行**；
并在「脚本」段明确写「**直接执行，不要先读源码；报错或输出看不懂时才读；参数不确定先跑 `--help`**」。

> 根因不只是技能写法：**skill-creator-v2 让人用 `<skill_dir>` 占位**，
> 而含占位符的命令不可直接运行 → 必然触发「先读源码」。这条已在 skill-creator-v2 本地补正。

---

## F. 本轮：备份上传闭环里踩的坑

### ❌ `bdpan whoami` 用来判断「是否已授权」

**现象**：用户点完授权链接，`bdpan whoami` 仍显示「未登录」，等待器一直不触发。
**原因**：`whoami` **只查状态、不领取待授权 key**；token 要由**下一条业务命令**领取。
**✅**：用 `bdpan ls /apps/bdpan` 之类业务命令触发领取，之后 `whoami` 才会显示「已登录」。

### ❌ 不加 `MSYS2_ARG_CONV_EXCL='*'` 调 bdpan / 脚本

**现象**（三个连环故障）：
- `--remote=/apps/bdpan/model-backup/x.zip` 被 Git Bash 转成
  形如 `<Git 安装目录>/apps/bdpan/...` 的路径 → 脚本的 `/apps/bdpan/` 前缀校验直接拒绝
- `bdpan ls /apps` → 路径被转 → 报「路径超出授权目录范围」
- `bdpan ls /` → 报 `errno=-7` 内部服务错误

**✅**：调 bdpan 或带路径参数的脚本前一律
`export MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1`；
脚本内部再加一道 `normalizeRemote()` 把被转过的路径还原（治标 + 兜底）。

### ❌ bdpan 的本地路径用 POSIX 形式

**现象**：`bdpan download <remote> /tmp/xxx` → 报参数错误。bdpan 是 Windows 原生程序，
`/tmp/xxx` 不是合法 Windows 路径。
**✅**：本地路径给 Windows 形式（`<系统临时目录>/xxx`）。

### ❌ 上传失败就当失败

**现象**：4 个包连传，第 2 个报 `HTTP 403 内部服务错误`，其余 3 个（含 1.7 GB）都成功。
**✅**：403 是瞬时的，**直接重试**即可成功。上传循环要带重试。

### ❌ 复制 `zip.exe` 到别的目录

**现象**：`zip.exe` 从 GnuWin32 安装目录跑正常，拷到 `~/.local/bin` 就 `exit=127`。
**原因**：它依赖同目录的 `zip32z64.dll`。
**✅**：脚本用 `resolveBin()` 指向真实安装路径；要用 PATH 里的 `zip` 就放 shell 包装脚本
（但 Node 的 `spawnSync` 不走 shell，执行不了无扩展名的包装脚本，脚本内部仍须用 `resolveBin()`）。

### ❌ 用 `zip -mhe=on` 想连文件名一起加密

**现象**：**exit=0 + 打印用法横幅 + 不产出任何包**（实测 `zip -P p -mhe=on a.txt out.zip`）。
**ZIP 格式不支持加密文件头**，`-mhe` 只有 7z 格式支持；zip 把 `-mhe=on` 当成
`-m`(move) `-h` `-e=on` 的组合短选项，认不出来就打印用法——**却仍返回 0**，
所以只判退出码的脚本会以为压好了，这是**静默失败**。
**✅**：通用 zip 只能加密内容（`zip -P`），文件名可见；要连文件名一起加密就得放弃通用 zip。

### ❌ 把中文名直接放进 zip

**现象**：GnuWin32 的 zip 是 ANSI 编译且**没有 `-UN` 选项**——实测本机**根本建不出包**：
只含中文名 → `exit=12 Nothing to do! (????.txt)`；中英混合 → `exit=3 Zip file structure invalid`。
在能匹配到名字的环境里则会被存成 `#U95ea#U4eae#U7f8e...` 转义，跨机器还原同样会废。
**✅**：包内一律 ASCII 名（`model.safetensors` / `model.json` / `manifest.json`），
原名与 sha256 记在 manifest 里，还原时换回。

---

## G. 测试与评审

### ❌ 断言自引用被测常量（同义反复）

**现象**：测试写 `eq('超级会员 32MB', sliceSizeFor(2), SLICE_BYTES.svip)` ——
看着在钉切片大小，实际是把常量跟自己比。**把常量从 32MB 改成 30MB，测试照样绿**。
是**变异检验**（把实现改坏，看测试会不会红）把它抓出来的。

**✅**：断言要钉**绝对值**（`32 * 1024 ** 2`），不能引用被测代码里同一个常量。
凡是「拿实现里的常量当期望值」的断言，一律改写。

### ❌ 评审只跑 grep 就收工

**现象**：说「已做 Ponytail 评审」，实际只跑了 grep、把顺手看到的问题改了，
既没读全 diff、没追调用方，也没交评审报告。**结果同一轮自己引入的 bug
（D 组那条 TDZ 遮蔽）就在评审范围里，却没被发现**。

**✅**：评审协议的三层都要走完：读全 diff → 追每个被改函数的调用方 →
按「错/险/规模/缺测/慢/臃」六类各查一遍 → **交报告**。
自己写的代码更要多花一遍，因为自己写的时候正是最容易漏的时候。
