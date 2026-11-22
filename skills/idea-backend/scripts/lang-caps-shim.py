#!/usr/bin/env python3
"""生成「本地 capability shim」插件：声明社区版平台不提供的语言能力模块。

    python scripts/lang-caps-shim.py <插件目录> <capability> [<capability>...]

产出：<插件目录>/lib/community-lang-caps.jar（含 META-INF/plugin.xml）。

为什么需要：IDEA 社区版平台的裁剪包（lib/intellij.idea.community.customization.jar）
只声明了 java-capable / python-core-capable / python-in-non-pycharm-ide-capable 三个
能力模块；Go / Rust 等语言插件依赖的 *-capable 模块因此装不上（IDEA 加载器直接拒）。
一个自带插件把同名 capability 声明出来，就能让这些语言插件在社区版加载。

⚠️ 非官方配置：JetBrains 不支持这种组合。仅供自用/非商业开发环境。
"""
import os
import sys
import zipfile

PLUGIN_ID = "com.intellij.community.langcaps"


def build(plugin_dir: str, caps: list[str]) -> str:
    lib = os.path.join(plugin_dir, "lib")
    os.makedirs(lib, exist_ok=True)
    lines = [
        "<idea-plugin>",
        f"  <id>{PLUGIN_ID}</id>",
        "  <name>Community Language Capabilities (local shim)</name>",
        "  <vendor>local</vendor>",
        "  <description>本地 shim：声明社区版平台不提供的语言能力模块，"
        "使对应语言插件能在 IDEA 社区版加载。非官方配置，仅供自用开发环境。</description>",
        "  <depends>com.intellij.modules.platform</depends>",
    ]
    lines += [f'  <module value="{c}" />' for c in caps]
    lines.append("</idea-plugin>")
    xml = "\n".join(lines)

    jar = os.path.join(lib, "community-lang-caps.jar")
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/plugin.xml", xml)
    return jar


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    plugin_dir, caps = argv[1], [a for a in argv[2:] if a.strip()]
    if not caps:
        print("ERROR: 至少给一个 capability 名", file=sys.stderr)
        return 2
    jar = build(plugin_dir, caps)
    print(f"  shim 已写: {jar}")
    print(f"  声明的 capability: {' '.join(caps)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
