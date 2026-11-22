"""跨文件调用点（T3 的引用面）——平铺导入，跨文件调用 probe_item 的两个锚点。"""

from probe_item import ProbeItem, probe_run


def consumer_use(ident: str) -> str:
    item = ProbeItem(ident, 1)
    return probe_run(item)
