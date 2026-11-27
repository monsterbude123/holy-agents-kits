---
name: doc-map-manager
description: "文档知识图谱管理器 — 为 docs/ 目录构建结构化索引（.docmap/docmap.db SQLite + 链接图谱 + 新鲜度评分），支持精确匹配、模糊搜索、ChromaDB / Zvec 语义向量检索、文档间链接查询（context）、影响面分析（impact）、新鲜度反幻觉验证。当用户需要 \"文档索引\"、\"搜索文档\"、\"文档地图\"、\"docmap\"、\"查找某篇文档的章节\"、\"更新文档索引\"、\"build index\"、\"查询文档\"、\"模糊搜索文档标题\"、\"语义搜索文档\"、\"文档影响面\"、\"文档关联查询\"、\"知识图谱\" 时自动加载。"
---
# 文档知识图谱管理器（doc-map-manager）

> **索引库是 SQLite（`<docs>/.docmap/docmap.db`），禁止直接 Read**——查询唯一入口 `query-index.py`。
> 定位：给 **agent** 用的结构化检索（标题/章节/链接图谱/新鲜度/影响面）；给人看的可视化全图走 `knowledge-surface` 技能，两者互补不抢触发。

## 前提

- **Python ≥ 3.9**（脚本用 PEP 585 泛型，3.8 及以下 import 即崩）；本机默认 `py -3` 若是 3.9，换 ≥3.9 解释器
- 精确查询只依赖标准库；`--fuzzy` / `--semantic` 的增强依赖缺失时自动降级（明细见 `references/architecture.md` §九）

## 快速开始（建 → 查）

脚本在本技能安装目录 `scripts/` 下；下例按默认安装位置展开（装在别处替换前缀）。
**直接执行下面的命令，不要先读脚本源码**；报错或输出不符合预期才读源码；参数不确定先跑 `--help`。

```bash
# 建索引（--docs-dir 指向目标项目 docs/；首次全量，日常加 --incremental）
python "$HOME/.agents/skills/doc-map-manager/scripts/build-index.py" --docs-dir <docs 目录>
python "$HOME/.agents/skills/doc-map-manager/scripts/build-index.py" --docs-dir <docs 目录> --incremental

# 查询（唯一入口）
python "$HOME/.agents/skills/doc-map-manager/scripts/query-index.py" --docs-dir <docs 目录> --grab "问题关键词"
```

## 主轴：按问题选命令

| 用户要什么 | 命令（`--docs-dir <docs 目录>` 同上，表中省略） |
|---|---|
| 「XXX 是什么 / 怎么做的」（要正文） | `query-index.py --grab "XXX"`（0.3s，含新鲜度） |
| 哪些文档提到某技术名词 | `query-index.py --lookup "gRPC"` |
| 文档关联（入站/出站链接） | `query-index.py --context-mode FILE.md` |
| 改某文档前的影响面 | `query-index.py --impact FILE.md` |
| 刚改了文档，谁要同步更新 | `build-index.py --detect-changes` |
| 不确定索引新不新 | `build-index.py --diff` → 有变化再 `--incremental` |
| 完全不知道关键词 | `query-index.py --semantic "自然语言"`（3s，需向量依赖） |

降级路径：`--grab` 无结果 → `--fuzzy`；拿到行号后 `read_file(offset, limit)` 局部读，不整文件读。

## 知识生命周期协议（反幻觉，4 步）

1. **查新鲜度**：🟢 ≥0.7 直接引用；🟡 0.3~0.7 标注「可能不是最新的」；🔴 <0.3 必须交叉验证
2. **涉及代码实现（API/配置/类名）必验证代码**：用代码图谱工具核对（本仓用 `analysis-codegraph` 技能）——文档说 Redis、代码是 Memcached → 报告不一致，不盲信文档
3. **回复附来源置信度**：「根据 docs/xxx.md（🟢 0.95）…」
4. **多点召回**：同一概念在 N 篇文档出现时全部读完再归纳，不基于单篇下结论

## 反模式（禁止）

| 禁止 | 正确 |
|---|---|
| 用户问文档问题直接 `grep` 盲搜 | 先 `--grab`（索引里有章节结构） |
| 先 `read_file` 手动翻找 | `--grab` 精确定位（token 黑洞） |
| 不理新鲜度直接引用 | 🟡🔴 必须标注「可能过时」 |
| 每次全量重建 | `--incremental`，或先 `--diff` 看有没有变化 |
| 改文档前不跑影响面 | `--impact FILE` 看入站/出站链接 |
| `--fuzzy` 拿到行号读整文件 | `read_file(offset, limit)` 局部读 |

## 边界

- 只管「建索引 + 查询 + 新鲜度/影响面」；不做给人看的可视化图（→ `knowledge-surface`）、不做代码符号图（→ `analysis-codegraph`）
- `.docmap/` 产物：`docmap.db` 建议 git track（便携）；`chroma/`、`zvec/` 与缓存进 `.gitignore`
- 五层架构、决策树全文、优先级表、排除目录配置、新鲜度评分规则、降级策略、依赖明细 → `references/architecture.md`

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
