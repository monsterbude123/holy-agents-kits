#!/usr/bin/env python3
"""生成 Jenkins Shared Library 脚手架（vars/ + src/ + resources/）。

只依赖标准库。用法:
    python generate_shared_library.py --name my-lib --package org.example --out .

产出目录结构:
    <out>/<name>/vars/          全局 step（vars/*.groovy，每个文件一个 step）
    <out>/<name>/src/<pkg>/     Groovy 类（src 下按包路径组织）
    <out>/<name>/resources/     模板与静态资源
    <out>/<name>/README.md      怎么引用、怎么扩展

退出码: 0 成功 / 2 用法或环境错（目录已存在且没给 --force 等）
stdout 是生成结果，stderr 是过程日志。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

VARS_LOG = """// 全局 step：log '开始构建'
def call(String msg) {
    echo "INFO: ${msg}"
}
"""

VARS_STEPS = """// 全局 step：deployImage '应用名' '标签'
// 凭据不进 Jenkinsfile：密码类用 credentialsId 引用，凭据本身存在 Jenkins 凭据库里。
def call(String app, String tag) {
    echo "构建 ${app}:${tag}"
    sh "docker build -t ${app}:${tag} ."
    sh "docker tag ${app}:${tag} ${app}:latest"
}
"""

SRC_UTILS = """package {pkg}

/** 共享工具：放在 src 下，按包路径引用 */
class Utils {{
    static String shortCommit(String sha) {{
        return sha?.take(8)
    }}
}}
"""

README = """# {name}

Jenkins Shared Library。

## 引用

```groovy
@Library('{name}') _
```

带版本：`@Library('{name}@1.0.0') _`（需在 Jenkins 里配置 library 的 SCM）。

## 结构

- `vars/` —— 每个 .groovy 文件 = 一个全局 step（文件名即 step 名）
- `src/` —— Groovy 类，按包路径组织（`src/{pkg_path}/`）
- `resources/` —— 模板与静态资源，用 `libraryResource` 读取

## 约定

- 凭据只用 `credentialsId` 引用，不在库里写明文
- 步骤要幂等：同一 step 跑两次结果一致
"""

RESOURCES_README = """# resources

放模板文件（.txt / .json / .sh 等），在 step 里用 `libraryResource` 读取：

```groovy
def tpl = libraryResource 'org/example/deploy.sh'
```
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="生成 Jenkins Shared Library 脚手架（vars/ + src/ + resources/）")
    parser.add_argument("--name", required=True, help="库名（目录名，如 my-lib）")
    parser.add_argument("--package", default="org.example", help="src 下的包名（默认 org.example）")
    parser.add_argument("--out", default=".", help="输出父目录（默认当前目录）")
    parser.add_argument("--force", action="store_true", help="目标目录已存在时覆盖")
    args = parser.parse_args(argv)

    name = args.name.strip()
    if not name or "/" in name or "\\" in name:
        print("错误：--name 只能是单个目录名", file=sys.stderr)
        return 2
    pkg = args.package.strip().strip(".")
    if not pkg:
        print("错误：--package 不能为空", file=sys.stderr)
        return 2

    root = Path(args.out).resolve() / name
    if root.exists() and not args.force:
        print("错误：目录已存在：%s（要覆盖请加 --force）" % root, file=sys.stderr)
        return 2

    pkg_path = pkg.replace(".", "/")
    files = {
        root / "vars" / "log.groovy": VARS_LOG,
        root / "vars" / "deployImage.groovy": VARS_STEPS,
        root / "src" / pkg_path / "Utils.groovy": SRC_UTILS.format(pkg=pkg),
        root / "resources" / "README.md": RESOURCES_README,
        root / "README.md": README.format(name=name, pkg_path=pkg_path),
    }

    print("[scaffold] 生成到 %s" % root, file=sys.stderr)
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  + %s" % path.relative_to(root.parent))

    print("完成：%d 个文件。下一步：把该目录作为 SCM 库配到 Jenkins，Jenkinsfile 里 @Library('%s') _" % (len(files), name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
