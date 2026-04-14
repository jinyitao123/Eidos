# UI Design System — 统一设计风格规范

**Version 1.1 · April 2026**
**适用范围**：Weave Console + 本体编辑器 + 备件管理 + 经营分析

---

## 一、设计原则

1. **深色优先**：所有产品默认深色主题，减少视觉疲劳
2. **一致性**：跨产品使用统一的色板、圆角、阴影、间距
3. **信息密度优先**：工具类产品不追求留白美学，追求信息可扫描性
4. **状态可见**：操作反馈即时可见（loading、success、error、blocked）

---

## 二、色板

### 2.1 背景层级

| 层级 | 色值 | 用途 |
|------|------|------|
| `bg-page` | `#1d1b16` | 页面最底层背景 |
| `bg-surface` | `#2a2825` | 卡片、弹窗、面板 |
| `bg-elevated` | `#3d3a35` | 悬浮菜单、tooltip、hover 状态 |
| `bg-input` | `#1d1b16` | 输入框背景 |

### 2.2 文字

| 层级 | 色值 | 用途 |
|------|------|------|
| `text-primary` | `#e8e5e0` | 标题、正文 |
| `text-secondary` | `#c5c2bc` | 描述、次要信息 |
| `text-tertiary` | `#9b9790` | 提示文字、标签 |
| `text-muted` | `#6b6560` | placeholder、禁用态 |

### 2.3 边框

| 层级 | 色值 | 用途 |
|------|------|------|
| `border-default` | `#3d3a35` | 卡片边框、分割线 |
| `border-input` | `#4d4a45` | 输入框边框 |
| `border-hover` | `#5d5a55` | hover 状态边框 |
| `border-focus` | `#d85a30` | focus 状态边框 |

### 2.4 品牌色

| 名称 | 色值 | HSL | 用途 |
|------|------|-----|------|
| `brand-primary` | `#d85a30` | hsl(16, 66%, 52%) | 主按钮、focus 光环、品牌标识 |
| `brand-hover` | `#c04e28` | — | 主按钮 hover |
| `brand-subtle` | `rgba(216,90,48,0.15)` | — | focus box-shadow |

### 2.5 语义色

| 名称 | 色值 | 用途 |
|------|------|------|
| `success` | `#0F6E56` | 完成状态、确认 |
| `success-text` | `#7dd3b8` | 成功消息文字 |
| `warning` | `#D97706` | 警告状态 |
| `danger` | `#b3261e` | 错误、危险操作 |
| `danger-text` | `#f2b8b5` | 错误消息文字 |
| `danger-hover` | `#8c1d18` | 危险按钮 hover |
| `info` | `#3B82F6` | 提示、链接 |

### 2.6 Agent 色（本体编辑器专用）

| Agent | 色值 | 用途 |
|-------|------|------|
| S1 场景分析 | `#993C1D` | 进度点、头像背景 |
| S2 本体架构 | `#0F6E56` | 进度点、头像背景 |
| S3 规则设计 | `#534AB7` | 进度点、头像背景 |
| S4 审核 | `#6B6560` | 进度点、头像背景 |

### 2.7 图谱节点色

| 类型 | 色值 | 用途 |
|------|------|------|
| 第一公民 | `#FAECE7` 背景 / `#993C1D` 文字 | 核心类节点 |
| 核心类 | `#E1F5EE` 背景 / `#0F6E56` 文字 | 普通类节点 |
| 事件类 | `#EDE9FE` 背景 / `#534AB7` 文字 | 事件/日志类节点 |

---

## 三、排版

### 3.1 字号

| 名称 | 大小 | 用途 |
|------|------|------|
| `text-xs` | 11px | 标签、badge、辅助 |
| `text-sm` | 13px | 表格内容、次要文字 |
| `text-base` | 14px | 正文、输入框 |
| `text-lg` | 16px | 小标题、弹窗标题 |
| `text-xl` | 20px | 页面标题 |
| `text-2xl` | 24px | 主标题 |

### 3.2 字重

| 名称 | 值 | 用途 |
|------|-----|------|
| `normal` | 400 | 正文 |
| `medium` | 500 | 按钮文字、标签 |
| `semibold` | 600 | 标题 |
| `bold` | 700 | 强调 |

### 3.3 字体

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif;
font-family-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
```

---

## 四、圆角

| 名称 | 值 | 用途 |
|------|-----|------|
| `radius-sm` | 6px | 按钮、输入框、chip |
| `radius-md` | 8px | 卡片 |
| `radius-lg` | 12px | 弹窗、面板 |

---

## 五、阴影

| 名称 | 值 | 用途 |
|------|-----|------|
| `shadow-card` | `0 1px 3px rgba(0,0,0,0.2)` | 卡片 |
| `shadow-elevated` | `0 8px 32px rgba(0,0,0,0.4)` | 弹窗、浮层 |
| `shadow-none` | `none` | 平面元素 |

---

## 六、组件规范

### 6.1 按钮

| 类型 | 背景 | 文字 | 边框 | hover |
|------|------|------|------|-------|
| Primary | `#d85a30` | `#fff` | none | `#c04e28` |
| Secondary | `#2a2825` | `#c5c2bc` | `1px solid #4d4a45` | `#3d3a35` |
| Danger | `#b3261e` | `#fff` | none | `#8c1d18` |
| Ghost | transparent | `#c5c2bc` | none | `#3d3a35` |

### 6.2 输入框

```css
background: #1d1b16;
border: 1px solid #4d4a45;
color: #e8e5e0;
border-radius: 6px;
padding: 10px 12px;
font-size: 14px;

&::placeholder { color: #6b6560; }
&:focus {
  border-color: #d85a30;
  box-shadow: 0 0 0 3px rgba(216, 90, 48, 0.15);
}
```

### 6.3 弹窗 (Modal)

```css
.overlay { background: rgba(0, 0, 0, 0.6); }
.modal {
  background: #2a2825;
  border: 1px solid #3d3a35;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.header { border-bottom: 1px solid #3d3a35; }
.footer { border-top: 1px solid #3d3a35; }
```

### 6.4 卡片

```css
background: #2a2825;
border: 1px solid #3d3a35;
border-radius: 8px;
padding: 16px;
transition: border-color 0.15s ease;

&:hover { border-color: #5d5a55; }
```

### 6.5 图标

- 使用 Lucide 风格 SVG 图标（18x18 默认尺寸）
- `stroke="currentColor"`, `strokeWidth="2"`, `strokeLinecap="round"`, `strokeLinejoin="round"`
- 不使用 emoji 作为功能图标（emoji 在不同平台渲染不一致）

### 6.6 状态指示

| 状态 | 图标 | 颜色 |
|------|------|------|
| running | `◆`（实心菱形） | `#d85a30` |
| done | `✓` | `#0F6E56` |
| error | `✗` | `#b3261e` |
| pending | `○`（空心圆） | `#6b6560` |

---

## 七、动画

| 名称 | CSS | 用途 |
|------|-----|------|
| `fade-in` | `opacity: 0 → 1, 0.15s ease` | 弹窗遮罩 |
| `slide-up` | `translateY(16px) → 0, 0.2s ease` | 弹窗内容 |
| `transition` | `0.15s ease` | hover、focus 状态切换 |

---

## 八、间距

| 名称 | 值 | 用途 |
|------|-----|------|
| `spacing-xs` | 4px | 内联元素间距 |
| `spacing-sm` | 8px | 紧凑布局 |
| `spacing-md` | 12px | 默认间距 |
| `spacing-lg` | 16px | 卡片内边距 |
| `spacing-xl` | 20px | 区块间距 |
| `spacing-2xl` | 24px | 页面边距 |

---

## 九、跨产品一致性要求

| 规则 | 说明 |
|------|------|
| 背景色统一 | 所有产品页面背景必须使用 `bg-page (#1d1b16)` |
| 弹窗统一 | 所有 Modal/Dialog 使用 `bg-surface (#2a2825)` + `border (#3d3a35)` |
| 输入框统一 | 所有输入框使用 `bg-input (#1d1b16)` + `border-input (#4d4a45)` |
| 按钮统一 | Primary 按钮使用 `brand-primary (#d85a30)`，不使用其他主色 |
| 图标统一 | 功能图标使用 SVG（Lucide 风格），不使用 emoji |
| 状态色统一 | success/warning/danger 色值跨产品一致 |
| 字体统一 | 中文优先使用 Noto Sans SC，英文使用系统字体栈 |

---

## 十、本体编辑器专有设计

### 10.1 Agent 对话页面

- 消息气泡：用户消息右对齐浅色，Agent 消息左对齐带头像
- Agent 头像：圆形色块 + 首字（如 `场` `本` `规` `审`），颜色来自 Agent 色板
- 工具调用状态：内嵌在消息底部，使用 `◆/✓/✗` 图标 + 工具中文名
- 阶段进度条：顶部水平布局，圆点 + 连接线，完成态变绿

### 10.2 图谱审核页面

- 全屏布局（负 margin 突破 AppShell padding）
- 左侧面板：类列表 + 规则 + 指标 + 遥测，固定宽度
- 右侧画布：force-directed 图，SVG 渲染
- 节点颜色：按类型着色（第一公民/核心/事件）
- 关系线：灰色半透明，hover 高亮

### 10.3 ClassEditor

- 属性表格：可拖拽排序，inline 编辑
- 指标卡片：展开式编辑，含 formula/depends_on/params/buckets
- 遥测卡片：context_strategy 嵌套编辑

---

## 十一、与 Weave Console 设计 Token 对照

| Weave Console (v1.0) | 本体编辑器 (v1.1) | 说明 |
|---------------------|------------------|------|
| `brand: hsl(217 91% 40%)` (蓝) | `brand: #d85a30` (橙) | 本体编辑器使用橙色系品牌色，区分于 Weave 蓝 |
| `accent: hsl(24 90% 55%)` | `#d85a30` | 一致 |
| `radius.sm: 6px` | `radius-sm: 6px` | 一致 |
| `radius.md: 8px` | `radius-md: 8px` | 一致 |
| `radius.lg: 12px` | `radius-lg: 12px` | 一致 |
| `spacing.page: 24px` | `spacing-2xl: 24px` | 一致 |
| `spacing.card: 16px` | `spacing-lg: 16px` | 一致 |
| Dark mode (Phase 2) | Dark mode (default) | 本体编辑器已默认深色，Weave Console 待跟进 |

---

## 十二、CSS 变量定义（推荐）

```css
:root {
  /* Backgrounds */
  --color-bg-page: #1d1b16;
  --color-bg-surface: #2a2825;
  --color-bg-elevated: #3d3a35;
  --color-bg-input: #1d1b16;

  /* Text */
  --color-text-primary: #e8e5e0;
  --color-text-secondary: #c5c2bc;
  --color-text-tertiary: #9b9790;
  --color-text-muted: #6b6560;

  /* Borders */
  --color-border-default: #3d3a35;
  --color-border-input: #4d4a45;
  --color-border-hover: #5d5a55;
  --color-border-focus: #d85a30;

  /* Brand */
  --color-brand: #d85a30;
  --color-brand-hover: #c04e28;
  --color-brand-subtle: rgba(216, 90, 48, 0.15);

  /* Semantic */
  --color-success: #0F6E56;
  --color-warning: #D97706;
  --color-danger: #b3261e;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Shadow */
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.4);

  /* Transition */
  --duration-fast: 0.1s;
  --duration-medium: 0.15s;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```
