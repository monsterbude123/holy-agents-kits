# 设计 → 开发 → 部署工作流

> 当用户需要**新建一个网页**时，打通 UI/UX 设计 → HTML 开发 → `publish deploy`。

---

## 适用场景

"帮我做个图站/页面/UI"、"设计一个 xxx 页面"、"用 uiux 设计并部署"

---

## 0. 守则

- 遵循 website-helper-skill §0 保密守则
- 遵循 ui-ux-pro-max Pre-Delivery Checklist

---

## 1. 流程总览

```
Step 1: 需求分析（产品/风格/素材/子域名）
   ↓
Step 2: 调用 Skill: ui-ux-pro-max 生成设计系统
   ↓
Step 3: 素材准备（复制已有图片 或 生成占位图）
   ↓
Step 4: HTML 开发（Tailwind CDN + 原生 JS）
   ↓
Step 5: publish deploy
   ↓
Step 6: curl 验证 HTTP 200
```

---

## 2. 详细步骤

### Step 1: 需求分析

| 维度 | 提取 |
|------|------|
| 产品类型 | "图站"=gallery, "博客"=blog, "落地页"=landing |
| 风格关键词 | 优雅/极简/暗色/动感 |
| 素材 | 已有 → 读取路径；无 → 需生成 |
| 子域名 | 用户指定名称 |

### Step 2: 调用 ui-ux-pro-max

**方法**：使用 Skill 机制唤起 `ui-ux-pro-max`（非硬编码路径）。

```powershell
# 通过 Skill: ui-ux-pro-max 生成设计系统
python <ui-ux-pro-max-skill-dir>/scripts/search.py "<类型> <风格>" --design-system -p "Project Name"
```

提取输出中的：Pattern / Style / Colors / Typography / Key Effects / Anti-patterns。

### Step 3: 素材准备

**情况 A**：用户已有图片 → 复制到 `.tmp-deploy/<name>/images-site/`

**情况 B**：需要生成 → 用 `text_to_image` API

### Step 4: HTML 开发

默认栈：Tailwind CDN + Google Fonts + 原生 IntersectionObserver + 原生 lightbox

**布局映射**：

| Pattern | 代码结构 |
|---------|---------|
| Portfolio Grid | Floating nav → Hero → Masonry → About → Contact |
| Hero-Centric | 粘性 navbar → 全屏 hero → 卡片区 → footer |

**CSS masonry**：
```css
.masonry { column-count: 1; column-gap: 1.25rem; }
@media (min-width: 640px) { .masonry { column-count: 2; } }
@media (min-width: 1024px) { .masonry { column-count: 3; } }
.masonry > * { break-inside: avoid; margin-bottom: 1.25rem; }
```

**JS 画廊**：
```javascript
const IMAGES = [{ file: "images/01.png", title: "...", meta: "..." }];
gallery.innerHTML = IMAGES.map((img, i) => `<figure class="card" data-index="${i}">...</figure>`).join("");
```

### Step 5: publish deploy

```powershell
publish deploy <name> -d <name>.<domain> -w .tmp-deploy\<name> --ip <云机器IP>
```

### Step 6: 验证

```powershell
curl -sI https://<name>.<domain> | Select-Object -First 5
```

---

## 3. 检查清单

```
[ ] ui-ux-pro-max design system 已生成
[ ] Pattern → 布局结构已确定
[ ] 素材已准备
[ ] Pre-Delivery Checklist 通过
[ ] publish deploy 成功
[ ] curl HTTP 200
```
