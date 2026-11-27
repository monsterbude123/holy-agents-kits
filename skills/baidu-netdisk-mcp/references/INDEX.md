# references

- `api-quirks.md` —— 百度网盘 MCP 的九个 API 陷阱（分页页大小、make_dir 重命名、category 字段、
  file_move 的 async 语义、depth 相对层数、特殊路径报错、mtime 来源、上传不覆盖、ZCode SSE 丢鉴权头）。
  排查报错或算出来的体量不对时读。
- `governance-playbook.md` —— 治理决策手册（两种「乱」的区分、体量-用途错配的识别、分类法设计、
  重复判定、隔离与删除的取舍、重排顺序、索引写法、汇报口径）。定分类法或用户问「该删什么」时读。
- `dirsize.md` —— 拿目录权威体积的正确接口（openapi `method=dirsize` 提交 + web 端
  `/mid_mucw/api/ostp/file/taskQuery` 取结果，path 支持逗号分隔批量）、为什么 openapi
  自己枚举文件加总会偏低、以及怎么从网盘 JS bundle 挖出未知接口。要目录大小时读。
- `counter-examples.md` —— 反例清单：这次实际犯过的 33 个错（枚举文件算目录体积会少一半、
  猜接口名、category 判目录、按 100 判断末页、make_dir 默认 rtype 造出时间戳空目录、
  async=1 误判失败、AbortSignal.timeout 提前退出、Git Bash 路径转换、并发开 mcp-remote、
  误以为 MCP 没有删除、agent 先读源码而不执行…）。动手前扫一眼。
- `counter-examples-runtime.md` —— 反例清单（脚本与运行时这一层）：参数解析的 NaN、块内 const 遮蔽、
  MCP 返回的 JSON 末尾少一个 `}`、`filelist` 参数类型、超大目录拖垮整批、幂等回查掩盖失败、扫描不剪枝。改脚本前读。
- `model-backup-method.md` —— 模型备份方法（我们自己的做法）：模型 + 同名附件 → zip 加密 → 上传网盘 → 台账，
  含命名/密码约定、还原流程与踩过的坑。要备份模型或还原备份时读。
- `transfer-protocol.md` —— 传输协议与实测边界：百度原生分片上传三段式、服务端驱动的续传、
  下载 dlink + Range、**两级哈希口径**（片级 md5 / 文件级 sha256 / 网盘 md5 为何不能当尺子）、
  bdpan CLI 的边界与速度基线。要传大文件、排查上传下载、或做同步之前读。
