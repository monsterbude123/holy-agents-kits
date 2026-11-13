#!/usr/bin/env python3
"""校验技能目录是否符合本仓规范。

用法：
    python validate_skill.py <skill_dir> [<skill_dir> ...]
    python validate_skill.py --all --root <仓库根目录>
    python validate_skill.py --all --json

退出码：0 = 全部通过；1 = 存在 error 级问题；2 = 用法错误。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from skill_schema import (  # noqa: E402
    DEFAULT_SKILL_MD_MAX_LINES,
    discover_skill_dirs,
    validate_skill,
)

LEVEL_MARK = {"error": "[ERROR]", "warn": "[WARN] "}


def format_report(info, require_feedback: bool = False) -> str:
    lines = ["技能：%s" % info.path.name]
    lines.append("  name: %s" % (info.name or "<缺失>"))
    lines.append("  正文行数: %d（上限 %d）" % (info.body_line_count, DEFAULT_SKILL_MD_MAX_LINES))
    lines.append("  引用: %d 个 references/，%d 个 scripts/" % (
        len(info.referenced_references), len(info.referenced_scripts)))
    if require_feedback:
        has_footer = any(i.code == "feedback.footer" for i in info.issues)
        lines.append("  反馈入口: %s" % ("缺失" if has_footer else "有"))
    if not info.issues:
        lines.append("  ✓ 通过")
        return "\n".join(lines)

    lines.append("")
    for issue in info.issues:
        lines.append("  %s %s: %s" % (LEVEL_MARK.get(issue.level, issue.level), issue.code, issue.message))
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="校验技能目录")
    parser.add_argument("targets", nargs="*", help="技能目录路径")
    parser.add_argument("--all", action="store_true", help="校验仓库内所有技能")
    parser.add_argument("--root", default=".", help="仓库根目录（配合 --all）")
    parser.add_argument("--max-lines", type=int, default=DEFAULT_SKILL_MD_MAX_LINES,
                        help="SKILL.md 正文行数上限（默认 %d）" % DEFAULT_SKILL_MD_MAX_LINES)
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--require-feedback", action="store_true",
                        help="检查 SKILL.md 末尾的仓库级反馈入口（--all 时默认开启）")
    parser.add_argument("--no-feedback-check", action="store_true",
                        help="跳过仓库级反馈入口检查（默认 --all 时开启）")
    args = parser.parse_args(argv)

    targets = [Path(t) for t in args.targets]
    if args.all:
        targets.extend(discover_skill_dirs(Path(args.root)))
    if not targets:
        parser.print_usage()
        print("错误：需要指定技能目录，或使用 --all", file=sys.stderr)
        return 2

    require_feedback = (args.all or args.require_feedback) and not args.no_feedback_check

    reports = []
    failed = False
    for target in targets:
        try:
            info = validate_skill(target, max_lines=args.max_lines,
                                  require_feedback=require_feedback)
        except FileNotFoundError as exc:
            reports.append({"skill": str(target), "error": str(exc)})
            failed = True
            continue
        reports.append({
            "skill": str(target),
            "name": info.name,
            "body_lines": info.body_line_count,
            "issues": [i.to_dict() for i in info.issues],
        })
        if any(i.level == "error" for i in info.issues):
            failed = True
        if not args.json:
            print(format_report(info, require_feedback))
            print("")

    if args.json:
        print(json.dumps({"reports": reports, "failed": failed}, ensure_ascii=False, indent=2))
    else:
        print("结论：%s" % ("存在 error 级问题，需修复" if failed else "全部通过"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
