# codebase-slimming · Admin 控制台大聚合与配置收敛规范

> 本指南总结了后台管理类界面（通常占大型项目 10%~20% 体量）普遍存在的“页面平展过多、抽屉重复手写、CRUD 样板水肿”病态模式与收敛方案。

---

## 一、 控制台三大典型病灶与重构处方

### 1. 业务资产“四分五裂”（配置一个实体跑 N 个页面）
- **反模式**：
  - 将一个业务概念的不同属性平铺成 4~5 个独立一级路由。
  - 实例：模型供应商在一页、模型目录在一页、模型定价在一页、工作流在另一页。用户配置一个模型必须跨 4 页来回跳转，每页都手写一套 Table、Filter、Pagination 和状态机。
- **收敛处方（N 合 1 工作台）**：
  - 将强相关的实体收敛至单一的工作台路由（如 `/admin/ai-assets`）；
  - 使用顶层 Tab 选项卡（供应商 / 模型 / 定价 / 工作流）切换；
  - 共享全局 Provider 过滤上下文，消除重复的页面脚手架代码。

### 2. Create 与 Edit 双份抽屉手写（结构 80% 重复）
- **反模式**：
  - 分别手写 `XxxCreateDrawer.tsx`（200 行）与 `XxxEditDrawer.tsx`（400 行）；
  - 80% 的 Form 字段、排版校验逻辑完全重合，仅仅差了一个“初始数据回显”和提交 API 动词。
- **收敛处方（单一受控抽屉模式）**：
  - 统一为单个 `XxxEditDrawer.tsx`；
  - 以可选的 `recordId?: string` 区分形态：
    - 无 `recordId`：标题展示“新建”，提交调用 `POST /api/admin/...`；
    - 有 `recordId`：标题展示“编辑”，初始根据 id 回显，提交调用 `PATCH /api/admin/...`；
  - 一次性削减上千行重复表单定义与维护成本。

### 3. 多头空重定向路由（配置中心幽灵壳）
- **反模式**：
  - 存在 `/admin/config-center` 导航卡片页，内部放了几个链接；
  - 同时存在 `/admin/config-center/prompts` 等子目录，代码里仅写 `permanentRedirect('/admin/prompts')`；
  - 既有独立路由又有嵌套重定向，概念多头并存。
- **收敛处方**：
  - 确定顶层路由为单一事实源（SSOT）；
  - 彻底物理删除所有仅用于 `permanentRedirect` 的中间空路由文件；
  - 精简侧边栏菜单（`navigation.ts`），保持导航结构与文件目录严格对称。

---

## 二、 通用 Admin CRUD 壳层抽离

在典型企业级中后台中，每个页面通常包含 80 行几乎完全相同的样板代码：
```tsx
const [search, setSearch] = useState('')
const [loading, setLoading] = useState(false)
const [data, setData] = useState([])
const [drawerOpen, setDrawerOpen] = useState(false)
// 手写 Ant Design Table columns, Pagination, 删除 Modal
```

**抽离标准**：
提炼 `<AdminPageShell />` 与公共表格容器：
- 内置搜索防抖、加载遮罩、分页联动与错误边界；
- 业务页面只声明数据源 Hook、列定义元数据与 Drawer 表单内容；
- 单个 CRUD 页面体积可从 400~600 行骤降至 100~150 行。
