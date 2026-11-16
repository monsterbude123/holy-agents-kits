# 画布配方与坑清单

## 1. ECharts 配方（tree 系列）

```js
chart = echarts.init(domEl);                 // 容器要先清干净（见坑 1）
chart.setOption(fullOption(), true);          // 第二参数 = notMerge（见坑 4）

{
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item', triggerOn: 'mousemove', enterable: false,
             formatter: tooltipHtml },
  series: [{
    type: 'tree', data: treeCache, orient: 'LR', edgeShape: 'curve',
    expandAndCollapse: true, roam: true,
    top: '2%', left: '5%', bottom: '2%', right: '28%',
    lineStyle: { width: 1.1, color: '#33415C' },
    emphasis: { focus: 'none' },
  }],
}
```

- `right: '28%'` 留给图例/说明；不给的话右侧节点会被裁掉。
- `edgeShape: 'curve'` 比默认折线柔和，深色底上更干净。
- `emphasis.focus: 'none'`：不要聚焦高亮——树一聚焦就变成「其余全灰」，反而看不清结构。

## 2. 状态归属：应用层 Map 是唯一真相源

ECharts 树把展开态存在内部（`node.isExpand`）。**任何一次重建（setOption）都会把它冲掉**。

```js
const collapsed = new Map();                  // id → 是否收起
// 渲染时读：collapsed.has(id) ? collapsed.get(id) : defaultCollapsed(n)
// 点击时写：collapsed.set(d.id, !!params.collapsed)   // 无论叶子还是分支都要写
```

**不要试图读回 ECharts 内部状态**：那是私有字段，版本一换就变。

## 3. 密度策略（「一眼全图」的开关）

节点一多，标签必然重叠。三条规则：

1. **自动展开层级**：按深度累加可见节点数，在 ≤ `NODE_BUDGET`（默认 120）的前提下取最深一层 → 默认展示骨架（根 → 组 → 文件），点开再往下钻。
2. **标签降级**：可见叶节点 > `LABEL_LIMIT`（默认 40）→ 叶/段只画点不画标签。文件节点标签始终保留，并加半透明底衬（`backgroundColor:'rgba(15,23,42,.72)'`），长标题互相压字时仍可读。
3. **搜索态强制显示标签**：命中项必须在图上能看见，`showLeafLabels = searching ? true : vis <= LABEL_LIMIT`。

## 4. 坑清单（都是真踩过的）

| # | 症状 | 原因 | 修法 |
|---|---|---|---|
| 1 | 点了没反应，事件全哑 | `echarts.init()` 会**清空容器**，把 loading 节点删掉后后续 `getElementById` 全空 | 先移除 loading 再 init；且用 `&&` 保护删除 |
| 2 | `arr.forEach is not a function` | `buildTree()` 返回了根对象 | 必须返回数组 `[root]` |
| 3 | 改了数据图不更新 | `setOption` 传了**同一对象引用** → ECharts 判定无变化直接跳过 | 深拷贝后再传 |
| 4 | 根节点凭空少了 9 个孩子 | tree 系列 **merge 会残留旧内部状态** | `setOption(opt, true)` 用 notMerge 全量替换 |
| 5 | 重建后展开态全丢 | 展开态存在 ECharts 内部 | 应用层 `collapsed` Map 作唯一真相源（见 §2） |
| 6 | 展开/收起按钮显示反了 | `params.collapsed` 是**切换后**的状态，不是切换前 | 回写用 `!!params.collapsed`，语义别搞反 |
| 7 | 递归统计节点数永远返回 0 | walker 收到的是数组 | 走缓存根对象 `buildTreeCache[0]` |
| 8 | 197 张卡片标签互相压字 | 无密度控制 | 见 §3 |
| 9 | 搜到了却看不见 | 密度规则把命中项的标签也藏了 | 搜索态强制显示标签 |
| 10 | 「展开全部/收起全部」只动了一半 | 边遍历边改集合 | 先算 `anyCollapsed` 再统一改 |
| 11 | 明细面板被文档里的尖括号搞坏 | HTML 插值未转义 | 所有插值走 `esc()` |
| 12 | 页面提示「ECharts 未加载」 | 模板里 `__ECHARTS_TAG__` 写在 `<script>` 内，替换值又是完整 `<script>` → 双层嵌套 | 占位符写成**裸标签**，由构建侧注入完整标签 |
| 13 | 一搜，整张图消失 | 搜索态把**根节点也设成收起** | 搜索态规则：`collapsed = !(isHit \|\| hasHitDescendant(id))`，根永远展开 |
| 14 | 文档内容里的 `$&`/`$1` 被吃掉，JSON 残缺 | `String.replace` 的字符串替换模式按 `$` 展开 | 用函数形式 `tpl.replace(k, () => value)` |
| 15 | 解析节点坐标总拿到 0 | zrender 的 `transform` 字符串是 `1,0,0,1,x,y`，**结尾没有 `)`**，用正则 `/\)$/` 匹配不到 | 用 `split(',')` 取 `[4]`/`[5]` |
| 16 | 合成事件点了没反应 | `zr.handler.dispatch()` 不走真实命中判定；`MouseEvent` 的 `clientX/Y` 必须是**页面坐标** | 见 §5 |

## 5. 自动化验收：怎么在浏览器里真点一次

CDP 的鼠标拖拽在无头环境常超时（`mouse input timed out`），改用**在页面里派发真实 MouseEvent**：

```js
const canvas = document.querySelector('#stage canvas');
const top = canvas.getBoundingClientRect().top;      // 画布在页面上的偏移
const opts = { clientX: x, clientY: y + top, bubbles: true, cancelable: true, view: window };
canvas.dispatchEvent(new MouseEvent('mousedown', opts));
canvas.dispatchEvent(new MouseEvent('mouseup', opts));
canvas.dispatchEvent(new MouseEvent('click', opts));
```

- `clientY` = **画布局内坐标 + 画布在页面上的 top**（画布常有 50px 左右的顶栏偏移，忘了加就永远点在错的地方）。
- 一次派发只触发一个动作：click 要单独再发一次 `click`，否则只有 mousedown/mouseup。

**定位某个节点的屏幕坐标**（显示列表里拿不到全局坐标，用 series 的 graphic el）：

```js
const data = chart.getModel().getSeriesByIndex(0).getData();
const el = data.getItemGraphicEl(i);          // i = 节点在 series 数据里的下标
const g = el.transformCoordToGlobal(0, 0, true);   // true = 相对 zrender 根
// 屏幕坐标 = g[0], g[1] + canvasTop
```

（`getItemLayout(i)` 给的是**布局坐标**，不是屏幕坐标；`getDisplayList()` 里元素的 `transform` 是局部变换，直接用会算错。）

**验证点击链路**的探针：

```js
chart.on('click', p => { window.__probe = { name: p.data.raw.title, type: p.data.raw.type, collapsed: p.collapsed }; });
```

派发完读 `window.__probe`，确认 name/type/collapsed 三项都对——这一步能直接验证坑 6 的语义。
