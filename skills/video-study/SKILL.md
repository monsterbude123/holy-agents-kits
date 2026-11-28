---
name: video-study
description: 把一个视频（课程/技术分享/讲座/教程/播客）加工成可直接用的学习材料：转写+全片采样摸底，按章节深挖关键段并抽关键帧，产出图文笔记 note.md 与按学习者画像裁剪的结构化学习包 study/（导航、原理深挖、概念迁移表、题库、验收标准、术语速查等模块按需组合）。机械层复用宿主已有视频工具（video-agent-kit 的转写与采样、ffmpeg），不做剪辑渲染，不管出题评分训练循环。用户说视频学习、看视频学、整理视频笔记、视频转学习包、这个视频讲了什么、帮我消化这个视频时用。
---

# Video Study — 视频学习加工

输入：一个视频（本地文件或可下载链接）+ 学习者背景（缺就问）。
产出：`<视频名>/` 一个目录 = `note.md`（图文笔记）+ `study/`（结构化学习包）+ `images/`（关键帧）。

## 怎么用

| 用户要什么 | 你做什么 |
|---|---|
| 学习这个视频 / 转成学习包 | 走全流程五步 |
| 只要视频笔记 / 这个视频讲了什么 | 走 Step 1–3，到 note.md 停 |
| 学习包已有，补或改某一块 | 读 [study-package-spec.md](references/study-package-spec.md)，只重做对应模块 |

## 五步主流程

**Step 0 立档** —— 确定视频路径与学习者画像（背景会什么 / 目标学来干什么 / 自认缺口），缺任何一项就问，不猜：画像直接决定 Step 4 的模块裁剪。建 `<视频名>/` 目录（`note.md`、`study/`、`images/`）。机械抽取全走宿主已有视频工具，工具对照表 → [video-tools.md](references/video-tools.md)；宿主没有视频工具或 ASR 不可用时停下报告，不手搓转写。

**Step 1 摸底** —— 先看元数据（时长/音轨），再转写全文 + 全片采样观察，得到章节结构；一章 = 一个主题完整闭环，按转写停顿与镜头边界切。按画面形态分叉：纯口播无板书演示 → Step 2 跳过抽帧，笔记按纯时间轴组织；有屏幕内容（幻灯片/代码/图表/演示）→ Step 2 逐段抽帧。

**Step 2 深挖** —— 对每章细看关键段：动作与动画用整段细看，屏幕小字与代码用原分辨率读帧；每章抽 1–3 张关键帧存 `images/`，文件名 = 序号+内容（如 `03-replit-agent-界面.jpg`）。铁律：每条结论都要能落到时间戳或帧上，记不清就回看，禁止凭印象补内容。

**Step 3 写笔记** —— `note.md` = 图文配对笔记：屏幕内容（引用 images/ 帧）与口播要点（转写）按章节编排，头部元信息+一句话总结，尾部 TL;DR。格式骨架 → [note-format.md](references/note-format.md)。

**Step 4 产学习包** —— `study/` 按画像裁剪模块：必产 README 导航、逐主题原理深挖、术语速查；选配概念迁移表（有旧领域经验）、题库（面试/考核导向）、动手验收标准（实操导向）、前置知识清单（入门导向）。模块决策表与各文件骨架 → [study-package-spec.md](references/study-package-spec.md)。三条纪律：数字必须可溯源到视频原话或画面；需要学习者本人真实经历处用 `[填空]` 占位、不许代填；讲原理讲边界（为什么这样设计、何时失效），不复述 API 用法。

**Step 5 收尾自检** —— 按 [study-package-spec.md](references/study-package-spec.md) 自检清单逐项过（图文对应、时间戳可溯、无臆测、导航可达），交付时报告产出清单 + 给学习者一条建议使用路径（先读什么后读什么）。

## 分叉与退出

| 情况 | 动作 |
|---|---|
| ASR 不可用、又没有现成字幕文件 | 停，报告缺口；不拿采样帧硬编讲稿内容 |
| 只有音频轨（播客/录音） | 当播客处理：跳过抽帧，笔记按时间轴，学习包照常 |
| 混剪无讲解结构 | 章节按镜头主题聚簇，并向用户明说"本片无连贯讲解" |
| 学习目标没说 | Step 0 必问；不默认任何场景（面试/求职是特例不是通例） |

## 参考文件

- [references/video-tools.md](references/video-tools.md) —— Step 1/2 选工具时读：宿主视频工具对照表（video-agent-kit / video2code / ffmpeg 降级）与落盘约定。
- [references/note-format.md](references/note-format.md) —— Step 3 写笔记时读：note.md 骨架模板与写作规则。
- [references/study-package-spec.md](references/study-package-spec.md) —— Step 4 产学习包、Step 5 自检时读：模块裁剪决策表、各文件骨架、纪律与自检清单。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
