#!/usr/bin/env python3
"""把超长的 SKILL.md 按主题自动抽取到 references/，并在原处留下引用。

抽取规则
--------
1. SKILL.md 正文按标题切分成章节。
2. 「核心」章节（标题命中 --keep-keyword，默认：流程 / 骨架 / 核心 / 循环 / 速查）
   永远留在 SKILL.md。
3. 其余章节按体量从大到小逐个搬进 references/<slug>.md，直到正文回到行数上限内。
4. 原文位置保留章节标题 + 一行引用指针，指向新文件。

用法：
    python split_skill.py <skill_dir> [--max-lines 150] [--dry-run]
    python split_skill.py <skill_dir> --keep-keyword 触发 --keep-keyword 边界
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent))

from skill_schema import (  # noqa: E402
    DEFAULT_SKILL_MD_MAX_LINES,
    Section,
    load_skill,
)

DEFAULT_KEEP_KEYWORDS = ["流程", "骨架", "核心", "循环", "速查", "cheatsheet", "quick reference"]

POINTER_TEMPLATE = "> 完整内容已抽取到 `references/{slug}.md`（原章节：{title}）。需要这部分细节时再读该文件。"


def slugify(title: str, index: int, taken: set) -> str:
    """标题 → 文件名 slug。中文标题回退到 section-<序号>。"""
    ascii_words = re.findall(r"[A-Za-z0-9]+", title.lower())
    slug = "-".join(ascii_words) or "section-%d" % index
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    base, suffix = slug, 2
    while slug in taken:
        slug = "%s-%d" % (base, suffix)
        suffix += 1
    taken.add(slug)
    return slug


def is_core(section: Section, keywords: List[str]) -> bool:
    if section.title == "":
        return True  # 前言保留
    lowered = section.title.lower()
    return any(kw.lower() in lowered for kw in keywords)


def parse_slug_overrides(items: List[str]) -> dict:
    """解析 `--slug "章节标题=目标文件名"` 参数。

    标题里是中文时自动 slug 只能得到 section-N 这种无意义名字，
    用这个参数可以显式指定可读的文件名。
    """
    mapping = {}
    for item in items or []:
        if "=" not in item:
            raise ValueError("--slug 格式应为「章节标题=文件名」，收到：%r" % item)
        title, _, name = item.partition("=")
        name = name.strip()
        if not name.endswith(".md"):
            name += ".md"
        mapping[title.strip()] = name
    return mapping


def write_reference(path: Path, title: str, body_lines: List[str]) -> None:
    header = ["# %s" % title, ""]
    # 章节正文紧跟标题，通常以空行开头——去掉，避免出现双空行
    while body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(header + body_lines).rstrip() + "\n", encoding="utf-8")


def update_index(references_dir: Path, entries: List[str]) -> None:
    """维护 references/INDEX.md：列出全部 reference 文件及其首行标题。"""
    index_path = references_dir / "INDEX.md"
    files = sorted(p.name for p in references_dir.glob("*.md") if p.name != "INDEX.md")
    lines = [
        "# references 索引",
        "",
        "本目录下每个文件都是 SKILL.md 正文的溢出内容，按需读取。",
        "",
    ]
    for name in files:
        first = ""
        for line in (references_dir / name).read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                first = line[2:].strip()
                break
        lines.append("- `%s` —— %s" % (name, first) if first else "- `%s`" % name)
    index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="抽取超长 SKILL.md 的溢出内容到 references/")
    parser.add_argument("skill_dir", help="技能目录")
    parser.add_argument("--max-lines", type=int, default=DEFAULT_SKILL_MD_MAX_LINES,
                        help="SKILL.md 正文行数上限（默认 %d）" % DEFAULT_SKILL_MD_MAX_LINES)
    parser.add_argument("--keep-keyword", action="append", dest="keep_keywords",
                        help="标题命中该关键词的章节保留在 SKILL.md（可重复）")
    parser.add_argument("--slug", action="append", dest="slugs",
                        help="指定目标文件名，格式「章节标题=文件名」（可重复）")
    parser.add_argument("--move", action="append", dest="forced",
                        help="强制搬走的章节标题（可重复），不受行数预算约束")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不落盘")
    args = parser.parse_args(argv)

    skill_dir = Path(args.skill_dir)
    keywords = args.keep_keywords or DEFAULT_KEEP_KEYWORDS
    slug_overrides = parse_slug_overrides(args.slugs)
    forced_titles = set(args.forced or [])

    info = load_skill(skill_dir)
    total = info.body_line_count

    candidates = [s for s in info.sections if not is_core(s, keywords)]
    forced = [s for s in candidates if s.title in forced_titles]
    optional = [s for s in candidates if s.title not in forced_titles]
    optional.sort(key=lambda s: s.line_count, reverse=True)
    candidates = forced + optional

    if total <= args.max_lines and not forced:
        print("无需拆分：正文 %d 行，未超过上限 %d 行。" % (total, args.max_lines))
        return 0

    references_dir = skill_dir / "references"
    taken: set = set()
    moved: List[tuple] = []  # (section, slug, filename)
    remaining = total

    for section in candidates:
        # 强制搬走的章节不受行数预算约束（例如正文里含实现型代码的章节）
        if remaining <= args.max_lines and section.title not in forced_titles:
            break
        index = len(moved) + 1
        if section.title in slug_overrides:
            filename = slug_overrides[section.title]
            slug = filename[:-3] if filename.endswith(".md") else filename
            taken.add(slug)
        else:
            slug = slugify(section.title, index, taken)
            filename = "%s.md" % slug
        # 章节整体搬走，原处只留 4 行（标题 + 空行 + 指针 + 空行）
        saved = section.line_count - 4
        remaining -= saved
        moved.append((section, slug, filename))

    if not moved:
        print("正文 %d 行超限，但所有章节都被判定为核心章节，无法自动拆分。" % total)
        print("请手工精简核心章节，或用 --keep-keyword 放宽保留范围。")
        return 1

    print("正文 %d 行 → 目标上限 %d 行" % (total, args.max_lines))
    for section, slug, filename in moved:
        print("  - %-40s → references/%s（%d 行）" % (section.title[:40], filename, section.line_count))

    if args.dry_run:
        print("（dry-run，未写入文件）")
        return 0

    # ---- 写 references/ -------------------------------------------------
    for section, slug, filename in moved:
        target = references_dir / filename
        if target.exists():
            print("  ! references/%s 已存在，未覆盖该章节" % filename)
            continue
        write_reference(target, section.title, section.lines[1:])

    # ---- 重写 SKILL.md 正文 ---------------------------------------------
    moved_titles = {s.title for s, _, _ in moved}
    new_lines: List[str] = []
    for section in info.sections:
        if section.title in moved_titles and section.title != "":
            slug = next(s for s, _, _ in moved if s.title == section.title)
            filename = next(f for s, _, f in moved if s.title == section.title)
            new_lines.append(section.lines[0])  # 保留标题作为锚点
            new_lines.append("")
            new_lines.append(POINTER_TEMPLATE.format(slug=filename[:-3] if filename.endswith(".md") else filename,
                                                     title=section.title))
            new_lines.append("")
        else:
            new_lines.extend(section.lines)

    skill_md = skill_dir / "SKILL.md"
    original = skill_md.read_text(encoding="utf-8")
    from skill_schema import FRONTMATTER_RE

    match = FRONTMATTER_RE.match(original)
    head = original[: match.end()] if match else ""
    skill_md.write_text(head + "\n".join(new_lines).rstrip() + "\n", encoding="utf-8")

    update_index(references_dir, [filename for _, _, filename in moved])

    after = len(skill_md.read_text(encoding="utf-8").splitlines())
    print("拆分完成，SKILL.md 现为 %d 行（原 %d 行）。" % (after, len(original.splitlines())))
    print("新增 references 文件 %d 个，索引已更新为 references/INDEX.md。" % len(moved))
    return 0


if __name__ == "__main__":
    sys.exit(main())
