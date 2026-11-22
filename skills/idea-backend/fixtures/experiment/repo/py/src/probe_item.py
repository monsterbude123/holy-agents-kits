"""探针：跨文件被引用的类与函数（T6 的 Python 侧锚点 + T2 的 function 锚点）。

平铺导入、无包、无相对导入 —— 只要 `py/src` 在 sys.path 上就解析得通
（IDEA 把 py/src 标成 source root、pyright 以 py/src 为 root，两者口径一致）。
"""


class ProbeItem:
    """类锚点：与 TypeScript 侧同名符号构成跨语言统一符号空间（T6 用）。

    ⚠️ 文档里**不写自己的符号名** —— 整词命中计数把注释/文档串也算进去，
    写进去会让 grep 口径比语义口径多一条，锚点就不可复核了。
    """

    def __init__(self, ident: str, count: int) -> None:
        self.ident = ident
        self.count = count

    def label(self) -> str:
        return f"{self.ident}:{self.count}"


def probe_run(item: ProbeItem) -> str:
    """被 probe_consumer 调用的函数锚点（T2 按位置找定义）。"""
    return item.label()
