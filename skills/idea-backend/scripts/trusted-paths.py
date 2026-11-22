#!/usr/bin/env python3
"""把工程目录写进 IDEA 的「受信任工程」列表（options/trusted-paths.xml）。

    python scripts/trusted-paths.py <trusted-paths.xml> <projectDir> [<projectDir>...]

为什么需要：IDEA 同步打开未信任工程时会弹「信任此工程」对话框，而那一刻主窗口
还没建起来 —— 弹框无人应答，IDE 表现为"卡死且没有任何窗口"。加上信任即可无交互打开。

新增项写 Windows 风格路径（IDE 存的就是反斜杠形式）；已存在则不重复添加。
"""
import re
import sys


def add(paths_file: str, dirs: list[str]) -> list[str]:
    s = open(paths_file, encoding="utf-8").read()
    added = []
    for d in dirs:
        key = d.replace("/", "\\")
        if re.search(r'key="%s"' % re.escape(key), s):
            continue
        entry = '        <entry key="%s" value="true" />' % key
        if "<map>" in s:
            s = s.replace("<map>", "<map>\n" + entry, 1)
        else:
            s = re.sub(r"(<map>)", r"\1\n" + entry, s, count=1)
        added.append(key)
    open(paths_file, "w", encoding="utf-8").write(s)
    return added


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    added = add(argv[1], argv[2:])
    if not added:
        print("  (已在信任列表里，无新增)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
