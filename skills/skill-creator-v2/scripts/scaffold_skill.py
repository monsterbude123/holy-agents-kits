#!/usr/bin/env python3
"""生成一个符合本仓规范的技能骨架。

骨架自带「主轴 → 步骤 → 判断」结构，天然控制在 150 行以内。
细节一律先占位到 references/，需要时再展开。

用法：
    python scaffold_skill.py <skills 根目录> <skill-name> --description "一句话说明"
    python scaffold_skill.py .agents/skills my-skill --description "..." --runtime node
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from skill_schema import FEEDBACK_URL  # noqa: E402

# 运行时三选一（规范见 references/structure.md §5，此处只有映射，不复制规则）
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "assets" / "templates"
RUNTIMES = {
    "node": {
        "script": "run.mjs",
        "template": "run.mjs.tmpl",
        "run_cmd": 'node "<skill_dir>/scripts/run.mjs" "hello"',
        "run_note": "Node ESM ≥ 20.12，零依赖",
    },
    "python": {
        "script": "run.py",
        "template": "run.py.tmpl",
        "run_cmd": 'python "<skill_dir>/scripts/run.py" "hello"',
        "run_note": "Python 标准库，零依赖",
    },
    "uv": {
        "script": "run.py",
        "template": "run.py.tmpl",
        "run_cmd": 'uv run "<skill_dir>/scripts/run.py" "hello"',
        "run_note": "Python + uv，依赖写在脚本头 PEP 723 块",
    },
}

ENV_EXAMPLE_TEMPLATE = """# 复制为 .env 后填写真实值；.env 不入库、不入分发包。
# 优先级：系统环境变量 > <项目根>/.agents/.env > <技能目录>/.env（详见脚本模板头部注释）
# TARGET_API_KEY=sk-xxx
"""

SKILL_MD_TEMPLATE = """---
name: {name}
description: {description}
---

# {title}

<!--
一句话说明这个技能解决什么问题、边界在哪。
description 决定触发率：写清「做什么」+「什么时候用」，必要时把触发词也列进来。
-->

## 第一屏：怎么做（主轴）

<!-- 读 15 行要能答上来：做什么 / 按什么顺序 / 在哪分叉。
     这里不要放术语表、目录树、原则清单——它们不是"先做什么"。 -->

- **<最主要的活>** = <一条命令，或 2~3 步>
- **<第二种活>** = <换哪个参数 / 换哪条路>
- **<失败岔路>**：<现象> → <先查什么>（细节指向 references/）

## 步骤

<!-- 每步一行：做什么 + 怎么算完成。命令别写进步骤行，集中到下面「脚本」段。 -->

1. **<步骤名>** —— <输入> → <产出>；完成判据：<怎么算这一步过了>
2. **<步骤名>** —— <输入> → <产出>；完成判据：<...>
3. **<步骤名>** —— <输入> → <产出>；完成判据：<...>

## 判断依据（挂在步骤上）

<!-- 概念与原则写进它管辖的那一步，不要单开"原则/铁律/概念"章节排在前面：
     规则脱离步骤单独成节，读者不知道它何时生效。 -->

- **Step N 的<判断点>** —— <依据>；换路条件：<什么时候不走这条>

## 循环与退出

<!-- 需要反复迭代的技能才写；一次成型的技能删掉本节。 -->

```
<输入> → <动作> → <校验> → (不通过) 回到 <动作>
                  └→ (通过) <产出>
```

**退出条件**：<何时算完成>

## §4 脚本

<!-- 可执行的确定性流程一律固化到 scripts/，正文只留调用方式。
     若报缺少环境变量：引导用户在 <技能目录>/.env 配置（对照 .env.example）。 -->

```bash
{run_cmd}
```

运行时：{run_note}；I/O 契约（stdout 单行 JSON / stderr 日志 / 退出码 0/1）已内置在脚本模板里。

## §5 参考文件

<!-- 详细协议、错误码、参数表等按需读取；每条都要写清「什么时候读」。 -->

- `references/<topic>.md` —— <何时读它>

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：{feedback_url}
"""

REFERENCES_INDEX_TEMPLATE = """# references 索引

本目录下每个文件都是 SKILL.md 正文的溢出内容，按需读取。

- `<topic>.md` —— <何时读它>
"""

SCRIPTS_README_TEMPLATE = """# scripts

本目录存放固化的可执行程序：把「每次都要重写一遍」的代码固定下来。

要求（运行时协议全文见 skill-creator-v2 references/structure.md §5）：
- 技术栈三选一：Node ESM（分发默认）/ Python 标准库 / Python + uv（PEP 723）
- stdout 只输出一行 JSON（ok/错误信封），日志走 stderr，成功退出 0、失败退出 1
- .env 定位基于脚本自身路径，不依赖 CWD；不覆盖已有环境变量
"""


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="生成技能骨架")
    parser.add_argument("root", help="技能父目录，如 skills 或 .agents/skills")
    parser.add_argument("name", help="技能名（kebab-case）")
    parser.add_argument("--description", default="", help="技能描述")
    parser.add_argument("--title", default="", help="技能中文标题（默认用 name）")
    parser.add_argument("--runtime", choices=sorted(RUNTIMES), default="node",
                        help="脚本运行时（默认 node，决策依据见 references/structure.md §5.1）")
    parser.add_argument("--force", action="store_true", help="目录已存在时覆盖 SKILL.md")
    args = parser.parse_args(argv)

    name = slugify(args.name)
    if not name:
        print("错误：技能名非法。", file=sys.stderr)
        return 2

    skill_dir = Path(args.root) / name
    skill_md = skill_dir / "SKILL.md"
    if skill_md.exists() and not args.force:
        print("错误：%s 已存在（加 --force 覆盖）。" % skill_md, file=sys.stderr)
        return 2

    runtime = RUNTIMES[args.runtime]
    template_path = TEMPLATES_DIR / runtime["template"]
    if not template_path.is_file():
        print("错误：缺少脚本模板 %s。" % template_path, file=sys.stderr)
        return 2

    description = args.description or "<一句话说明：做什么 + 什么时候用>"
    title = args.title or name

    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "references").mkdir(exist_ok=True)
    (skill_dir / "scripts").mkdir(exist_ok=True)

    skill_md.write_text(
        SKILL_MD_TEMPLATE.format(name=name, description=description, title=title,
                                 feedback_url=FEEDBACK_URL,
                                 run_cmd=runtime["run_cmd"], run_note=runtime["run_note"]),
        encoding="utf-8",
    )
    (skill_dir / "references" / "INDEX.md").write_text(REFERENCES_INDEX_TEMPLATE, encoding="utf-8")
    (skill_dir / "scripts" / "README.md").write_text(SCRIPTS_README_TEMPLATE, encoding="utf-8")
    (skill_dir / ".env.example").write_text(ENV_EXAMPLE_TEMPLATE, encoding="utf-8")
    (skill_dir / "scripts" / runtime["script"]).write_text(
        template_path.read_text(encoding="utf-8").replace("__SKILL_NAME__", name),
        encoding="utf-8",
    )

    print("已生成技能骨架：%s（runtime=%s）" % (skill_dir, args.runtime))
    print("  SKILL.md（%d 行）、.env.example、scripts/%s" % (
        len(skill_md.read_text(encoding="utf-8").splitlines()), runtime["script"]))
    print("  references/INDEX.md、scripts/README.md")
    print("下一步：先写「第一屏：怎么做」这张主轴，把细节写进 references/，再改 scripts/%s 的 TODO。" % runtime["script"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
