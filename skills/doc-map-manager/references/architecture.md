# doc-map-manager · 架构与运行明细

> SKILL.md 的溢出细节：五层架构、决策树全文、优先级表、反模式、排除配置、新鲜度规则、降级策略、依赖与维护约定。
> 正文只留主轴与快速命令；本文是按需查阅的明细层。

## 一、五层架构

```
L5 验证层 — 新鲜度评分 + 反幻觉尾注
L4 变更层 — detect-changes / impact（概念级变更检测）
L3 查询层 — grab / lookup / fuzzy / semantic / context
L2 关系层 — 链接图谱（入站/出站）+ 标签 + frontmatter 元数据
L1 索引层 — 标题 / 章节行号 / 面包屑
```

## 二、Agent 决策树

```
用户问的是...
│
├── "XXX怎么实现的？""XXX是什么？""XXX流程？"
│   └── 🎯 query-index.py --grab "XXX"           ← P0 首选
│       ├── 有结果 → 检查新鲜度 → 涉及代码? → 代码图谱验证 → 回复
│       └── 无结果 → 降级 --fuzzy，拿到行号后局部 read_file
│
├── "哪些文档提到了gRPC/websocket/某个技术名词？"
│   └── 🎯 query-index.py --lookup "技术名词"
│
├── "ARCHITECTURE.md 引用了哪些文档？被哪些文档引用？"
│   └── 🎯 query-index.py --context-mode ARCHITECTURE.md
│
├── "修改 ARCHITECTURE.md 会影响哪些文档？"
│   └── 🎯 query-index.py --impact ARCHITECTURE.md
│
├── "刚才改了文档，有哪些文档引用了它需要同步更新？"
│   └── 🎯 build-index.py --detect-changes
│
├── 会话刚开始 / 不确定文档有没有更新
│   └── 🎯 build-index.py --diff
│       ├── 无变化 → 直接用已有索引
│       └── 有变化 → build-index.py --incremental
│
├── "更新文档索引" / "build index"
│   └── 🎯 build-index.py --incremental（语义检索另加 --zvec）
│
└── "搜索XX相关文档"（不知道关键词）
    └── 🎯 query-index.py --semantic "自然语言描述"
```

> 涉及代码实现的验证：用代码图谱工具核对（本仓对应 `analysis-codegraph` 技能的 impact / explore），
> 替代原稿的 GitNexus context()——文档说 Redis、代码是 Memcached → 报告不一致，不盲信文档。

## 三、优先级铁律

| 优先级 | 工具 | 适用场景 | 耗时 | 置信度 |
|--------|------|---------|------|-------|
| **P0** | `--grab "问题"` | 用户问文档里某件事 | 0.3s | 含新鲜度 |
| **P0.5** | `--context-mode FILE` | 查看文档关联关系 | 0.3s | 链接图谱 |
| **P1** | `--lookup "关键词"` | 知道精确技术名词 | 0.2s | 含新鲜度 |
| **P1.5** | `--impact FILE` | 修改前影响评估 | 0.3s | 链接+标签 |
| **P2** | `--fuzzy "描述"` | grab 无结果降级 | 0.5s | 含新鲜度 |
| **P3** | `--semantic "自然语言"` | 完全不知道关键词 | 3s | 依赖模型 |
| **P4** | `--file xxx.md` | 浏览文件结构 | 0.3s | — |
| **P5** | `read_file(...)` | 仅当上面都不可用 | 高 token | — |

## 四、反模式（禁止行为）

| 禁止 | 原因 | 正确做法 |
|------|------|---------|
| ❌ 用户问文档问题，直接用 `grep` 搜 | 不知道章节结构，盲搜低效 | ✅ 先 `--grab` |
| ❌ 先 `read_file` 手动翻找 | token 黑洞 | ✅ `--grab` 精确定位 |
| ❌ 拿到结果不理新鲜度直接引用 | 🔴 文档可能过时 | ✅ 检查新鲜度，🟡🔴 标注 |
| ❌ 文档提到 API/配置/类名不验证代码 | 文档可能落后代码 | ✅ 代码图谱验证（analysis-codegraph） |
| ❌ 每次都全量重建 | 慢 | ✅ `--incremental` 或先 `--diff` |
| ❌ 修改文档前不跑 `--impact` | 不知道会影响哪些关联文档 | ✅ `build-index.py --impact FILE` |
| ❌ 拿到 `--fuzzy` 行号后读整个文件 | 浪费 token | ✅ `read_file(offset=line, limit=range)` |

## 五、典型对话模板

**用户**: "Agent 通信怎么设计的？"

```
1. python query-index.py --grab "Agent 通信"
2. 拿到 → 原文 + 新鲜度（🟢/🟡/🔴）
3. 涉及代码实现 → 代码图谱验证（analysis-codegraph）
4. 回复用户（标注新鲜度 + 交叉验证结果）
```

**用户**: "修改架构文档前，帮我看看影响面"

```
1. python query-index.py --impact ARCHITECTURE.md
2. 输出：入站链接 5 篇 + 出站链接 3 篇 + 风险等级
3. 告知用户影响范围，再动手修改
```

**用户**: "刚才改了 adr-007.md，哪些文档需要同步？"

```
1. python build-index.py --detect-changes
2. 输出：变更文件列表 + 入站链接文档（需要同步更新）
```

## 六、排除目录配置

构建索引时默认排除的目录通过 `.docmap/config.json` 配置（按项目独立配置）：

```json
{
  "exclude_dirs": ["bak_v8doc", "references"]
}
```

- 文件位置：`{项目docs目录}/.docmap/config.json`
- 首次运行 `build-index.py` 时自动创建（含默认值）
- 修改后下次构建自动生效，无需改脚本代码

## 七、新鲜度评分规则

| 距离上次修改 | 评分 | 图标 | 含义 |
|------------|------|------|------|
| 0~7 天 | 1.0 → 0.7 | 🟢 | 新，可信任 |
| 7~30 天 | 0.7 → 0.3 | 🟡 | 注意检查 |
| 30~90 天 | 0.3 → 0.1 | 🔴 | 可能过时 |
| 90+ 天 | ≤ 0.1 | 🔴 | 过时，必须验证 |

## 八、降级策略

```
--semantic: Zvec → ChromaDB → TF-IDF 降级
--fuzzy: rapidfuzz → difflib 降级
精确/LOOKUP: SQLite SELECT + LIKE（毫秒级）
```

## 九、依赖与运行前提

| 项 | 要求 | 说明 |
|------|------|------|
| Python | **≥ 3.9**（PEP 585 泛型，3.8 及以下 import 即崩） | 实测 3.13 ✓；本机默认 `py -3` 若为 3.9 需换 ≥3.9 解释器 |
| `sqlite3` | 必需 | Python 标准库 |
| `rapidfuzz` | `--fuzzy` 增强 | `pip install rapidfuzz`（缺失自动降级 difflib） |
| `chromadb` | `--chroma` / `--semantic` | `pip install chromadb`（缺失自动降级） |
| `zvec` | `--zvec` / `--semantic` | `pip install zvec`（缺失自动降级） |
| `sentence_transformers` | 本地 Embedding | `pip install sentence_transformers`（缺失回退 ChromaDB） |

精确查询（`--grab` / `--lookup` / `--context-mode` / `--impact`）只依赖标准库，零增强依赖可用。

## 十、维护约定

1. `.docmap/docmap.db` 是 SQLite，禁止手动编辑
2. `.docmap/chroma/` 和 `.docmap/zvec/` 加入 `.gitignore`
3. `.docmap/docmap.db` 建议 git track（便携）
4. 新增文档后运行 `build-index.py --incremental` 更新
5. 构建会自动计算新鲜度 + 提取链接图谱 + 标签
