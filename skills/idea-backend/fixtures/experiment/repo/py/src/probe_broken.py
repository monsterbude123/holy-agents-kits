"""故意写坏的文件（T5 单文件诊断的靶子）—— Python 解析器必拒的语法错。

错误形态与 idea-backend Python 分册的实测样本同款（`def name(:`）：
IDEA 侧 `ide_diagnostics` 报 "Formal parameter name expected" / "':' expected"，
pyright 侧报同类语法错。**这里只放一处错** —— 诊断条数的差异只可能来自引擎的计数粒度。
"""


def broken(:
    return 1
