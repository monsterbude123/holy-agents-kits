#!/usr/bin/env python3
"""video-study 产物自检：Step 5 的四类机械项一次跑完。

用法:
    python check-output.py <产物目录>

产物目录 = 含 note.md / study/ / images/ 的那一层。检查:
  1. note.md 里引用的本地图片都在盘上
  2. study/ 下每个 .md（README.md 除外）都被 study/README.md 导航到
  3. note.md 每个「讲点」下的要点都带 mm:ss 时间戳（弹点与数字列表都认；
     note-format 骨架规定用弹点，数字列表本身属格式偏差，但漏检比误报危险——
     报出来让作者顺手改回弹点或补时间戳，两个问题一起解决）
  4. README 若宣称「术语速查（N 条）」，全部术语文件的表格数据行**求和**等于 N
     （spec 规定术语速查单件必产；出现多个含「术语」的文件时按总和核对，
     免得静默只查第一个造成假绿）

退出码: 0 全过；1 有失败项；2 目录结构不对（缺 note.md 或 study/）。
"""
import re
import sys
from pathlib import Path

IMAGE_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")
BULLET_RE = re.compile(r"^\s*(?:[-*]|\d+[.、)])\s+(.*)$")
TS_RE = re.compile(r"\d{1,2}:\d{2}")
CLAIM_RE = re.compile(r"术语[^\n]{0,24}?(\d+)\s*条|(\d+)\s*条术语")
SEP_ROW_RE = re.compile(r"^\|[\s:\-|]+\|$")


def read(path):
    return path.read_text(encoding="utf-8", errors="replace")


def check_images(root, note_text, problems):
    refs = [m for m in IMAGE_RE.findall(note_text) if not re.match(r"^[a-z]+://", m)]
    missing = [r for r in refs if not (root / r).is_file()]
    for r in missing:
        problems.append("引用的图片不存在：%s" % r)
    print("[%s] 图片引用 %d 个，缺失 %d 个" % ("OK" if not missing else "FAIL", len(refs), len(missing)))


def check_navigation(study, problems):
    readme = study / "README.md"
    if not readme.is_file():
        problems.append("缺少 study/README.md（导航必产）")
        print("[FAIL] 缺少 study/README.md")
        return
    text = read(readme)
    files = sorted(p for p in study.glob("*.md") if p.name != "README.md")
    # 导航表常写不带 .md 的短名（如「术语速查（12 条）」），两种写法都算导航到
    orphans = [p.name for p in files if p.name not in text and p.stem not in text]
    for name in orphans:
        problems.append("study/%s 没有被 README 导航" % name)
    print("[%s] study 文件 %d 个，未被导航 %d 个" % ("OK" if not orphans else "FAIL", len(files), len(orphans)))


def check_timestamps(note_text, problems):
    missing = []
    section = ""
    in_points = False
    for line in note_text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
            in_points = False
        elif "**讲点**" in line:
            in_points = True
        elif in_points and line.startswith((">", "**", "#")):
            in_points = False
        elif in_points:
            m = BULLET_RE.match(line)
            if m and not TS_RE.search(m.group(1)):
                missing.append("%s：%s" % (section or "?", m.group(1).strip()[:40]))
    for item in missing:
        problems.append("讲点无时间戳（%s）" % item)
    print("[%s] 讲点缺时间戳 %d 条" % ("OK" if not missing else "FAIL", len(missing)))


def _table_rows(path):
    rows = 0
    for line in read(path).splitlines():
        if not line.strip().startswith("|") or SEP_ROW_RE.match(line.strip()):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0] and not set(cells[0]) <= set("-: "):
            rows += 1
    return max(rows - 1, 0)  # 去掉各文件自己的表头


def check_glossary(study, readme_text, problems):
    glossaries = sorted(p for p in study.glob("*.md") if "术语" in p.name)
    claims = [m.group(1) or m.group(2) for m in CLAIM_RE.finditer(readme_text)]
    if not glossaries:
        print("[SKIP] 未找到术语文件，跳过条数核对")
        return
    rows = sum(_table_rows(p) for p in glossaries)
    names = "、".join(p.name for p in glossaries)
    if not claims:
        print("[SKIP] README 未宣称术语条数（实际 %d 条）" % rows)
        return
    claimed = int(claims[0])
    ok = claimed == rows
    if not ok:
        problems.append("术语条数不一致：README 宣称 %d 条，实际 %d 条（%s）" % (claimed, rows, names))
    print("[%s] 术语条数 README=%d 实际=%d（%d 个文件：%s）" % ("OK" if ok else "FAIL", claimed, rows, len(glossaries), names))


def main():
    if len(sys.argv) != 2:
        print(__doc__.strip())
        return 2
    root = Path(sys.argv[1]).resolve()
    note = root / "note.md"
    study = root / "study"
    if not note.is_file() or not study.is_dir():
        print("[FAIL] %s 下缺 note.md 或 study/，不是 video-study 产物目录" % root)
        return 2

    note_text = read(note)
    readme_text = read(study / "README.md") if (study / "README.md").is_file() else ""
    problems = []
    check_images(root, note_text, problems)
    check_navigation(study, problems)
    check_timestamps(note_text, problems)
    check_glossary(study, readme_text, problems)

    if problems:
        print("\n自检失败 %d 项：" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1
    print("\n自检全过。判断题（无臆测 / 图文对应 / 画像裁剪）仍需人工过一遍 spec 清单。")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
