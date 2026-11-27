# 百度网盘 MCP API 陷阱

全部来自实际整理一个 十几 TB 量级 网盘的会话。每个陷阱都会静默给出**错误结论**，不是报错。

---

## 1. `file_list` 每页只有 10 条

按 100 条判断「最后一页」会在第 1 页就停 —— 每个目录只看到前 10 项。

**后果**：体量统计偏小、重复检测漏报。曾因分页写错，把两个各 93.6 GB 的重复树看成只有 74% 重合。

```js
const PAGE_SIZE = 10;
for (let page = 1; ; page++) {
  const items = await listPage(dir, page);
  if (!items.length) break;          // 翻到空页为止
  acc.push(...items);
  if (items.length < PAGE_SIZE) break;
}
```

`file_list` 也有隐式上限：不给 `page` 时返回的是**排序后的前若干条**，不是全部。

---

## 2. `make_dir` 默认会重命名，不会复用

`rtype` 默认 `1`（path 冲突则重命名）。批量建目录时，**每建一次就多一个 `_YYYYMMDD_HHMMSS` 副本**。

**后果**：建 44 个目录 → 根目录多出 44 个空目录；`file_move` 的 dest 必须是字面路径，重命名产生的副本路径 `xxx_时间戳` 不会被自动跟随。

- 建目录一律显式传 `rtype: "0"`（冲突时返回冲突，不创建副本）
- `file_move` 的 dest 拼的是字面路径，先确认它存在

---

## 3. `category` 字段不可靠

`.safetensors` / `.7z` / `.mp4` 等文件的 `category` 也是 `6`（与目录同值）。

**后果**：只按 `category === 6` 判目录，会把几十 GB 的模型文件当目录去 list（返回空），**体积直接漏算**（曾漏掉 900 GB）。

```js
const isDir = (n) => Number(n.category) === 6 && !n.md5;  // 目录 md5 为空，文件必有 md5
```

---

## 4. `file_move` 的 async 语义

| async | 行为 | 返回 |
|---|---|---|
| `0` 同步 | 立即执行完 | `info[]` 每条带 `errno` 和 `to_path` |
| `1` 自适应 | **只是受理**，文件可能几分钟后才落地 | `info[]` 可能为空，`errno:0` **不代表搬成功** |
| `2` 异步 | 提交后台任务 | 返回 `taskid` |

**后果（连锁踩坑）**：

1. 用 `async:1` 批量搬完立刻校验 → 看到「源还在」→ 误判失败
2. 重跑时第一批已落地 → 源不存在 → 报 **`errno:-9`**
3. 同步模式搬超大目录 → 直接拒：**`errno:-8`**

**正确做法**：小批量 + `async:0` + 逐项解析 `info[]`；遇 `-9` 不要当失败，回源/目标核对（源真不在、目标已在 = 已完成，幂等）；超大目录单独 `async:1` 提交后轮询。

顶层 `errno:12` = 整批失败。`errno:2003` = token 无效。

---

## 5. `depth` 是相对扫描根的层数

自己写的扫描器把 `depth` 记成「相对本次 root 的层数」。不同 root 扫同一棵树，父子层数会错位。

**后果**：自底向上汇总体积时顺序错乱，父目录总量算错（实测 `/02_课程` 少算 1.5 TB）。

**修法**：汇总排序用**路径里的斜杠数**算绝对层数，不信 `depth` 列。

---

## 6. 路径含 `+` 或全角括号 → `errno:1002`

`file_list` / `file_move` 遇到某些路径会返回「请求数据为空」。把路径 URL 编码后再试，或绕开该目录、改用 `file_keyword_search` / `file_semantics_search`。

Git Bash 下另一个坑：`--path=/课程` 会被 MSYS 转成 Git 安装目录下的 `课程`（形如 `Program Files/Git/课程`）。跑脚本必须加 `MSYS2_ARG_CONV_EXCL='*'`。

---

## 7. `file_list` 不返回 mtime

想知道「这些文件多久没碰过」只能靠 `file_keyword_search` / `file_semantics_search`（它们返回 `server_ctime` / `server_mtime`）或 `file_meta`。

`server_ctime` 是**上传时间**，`server_mtime` 常是网盘批量整理的时间（很多文件 mtime 完全相同）。判断陈旧度用 ctime 更准。

---

## 8. `file_upload_by_content` 不覆盖同名

同名会生成带时间戳的副本（`xxx_20261127xxxx.md`），不会覆盖。旧文件要手动挪走。

---

## 9. ZCode 里 baidu-server 显示红色 / toolCount=0

不是配置错。ZCode 的 SSE 客户端用 undici `EventSource`，**首次 `GET /sse` 会丢掉 `Authorization` 头**（同一链路的 POST 带了，GET 没带）。服务端对匿名 SSE 连接不报错，只是 `tools/list` 返回 `{"tools":[]}`。

**验证**：原始 node https / curl 连同一 token 稳定拿到 25 个工具，undici `EventSource` 稳定拿到 0 个。

**解法**：把该 server 配成 stdio 桥，让 `mcp-remote` 替 ZCode 发那个带 auth 的 GET：

```json
"baidu-server": {
  "type": "stdio",
  "command": "mcp-remote",
  "args": ["https://mcp-pan.baidu.com/sse", "--transport", "sse-only",
           "--header", "Authorization: Bearer <token>"],
  "timeoutMs": 120000
}
```

`mcp-remote` 全局安装（`npm i -g mcp-remote`）。不加 `--transport sse-only` 会先 POST 探测 `/sse`（405）再回退，多一次往返。**不要并发开多个 mcp-remote**，会掉连接。
