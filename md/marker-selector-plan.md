# 标记点样式选择器 修改方案

## 当前架构

设置通过以下链路传递到前端：

```
settings.yaml -> BaseConfig.java -> FootprintRouter.java -> footprint.html (Thymeleaf) -> window.FOOTPRINT_CONFIG
```

`FOOTPRINT_CONFIG` 中已有 `mapStyle`，前端通过 Thymeleaf 语法注入。

---

## 修改方案

### 1. settings.yaml —— 新增后端设置项

在 `base` 分组、`mapStyle` 下方新增 `markerStyle` 下拉选择：

```yaml
        - $formkit: select
          name: markerStyle
          label: 标记点样式
          value: pin
          options:
            - label: 水滴标记
              value: pin
            - label: 简约圆形
              value: circle
            - label: 卡片标记
              value: card
```

### 2. BaseConfig.java —— 新增字段

```java
private String markerStyle;  // 默认 pin
```

### 3. footprint.html —— 前端注入

在 `<body>` 上添加样式类：

```html
<body th:class="'marker-style-' + ${settings.markerStyle}">
```

在 `FOOTPRINT_CONFIG` 中新增 `markerStyle`：

```js
markerStyle: /*[[${settings.markerStyle}]]*/ 'pin'
```

### 4. footprint.css —— CSS 整合

用 `marker-style-*` 类作用域区分三套样式，每个选择器前加 `.marker-style-pin` / `.marker-style-circle` / `.marker-style-card` 前缀。

**水滴标记（pin）**：当前样式，水滴形 + 白色边框
**简约圆形（circle）**：40px 正圆 + 主题色边框 + 右下角徽章
**卡片标记（card）**：flex column，名称标签 + 50x36 图片 + 三角箭头

### 5. footprint.js —— JS 整合

`createMarker` 改为生成完整 HTML，包含全部三种样式需要的元素：

```js
markerContent.innerHTML = `
    <div class="marker-label">${spec.name || ''}</div>
    <div class="marker-image">
        <img src="${compressedImageUrl}" alt="${spec.name || '足迹标记'}" decoding="async">
    </div>
    <div class="marker-badge">${spec.footprintType ? spec.footprintType.charAt(0) : ''}</div>
    <div class="marker-arrow"></div>
`;
```

哪个元素可见由 CSS 的 `marker-style-*` 类控制，无需 JS 动态切换。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `extensions/settings.yaml` | base 分组新增 `markerStyle` 下拉 |
| `dto/BaseConfig.java` | 新增 `markerStyle` 字段 |
| `templates/footprint.html` | `<body>` 加样式类 + `FOOTPRINT_CONFIG` 加字段 |
| `static/css/footprint.css` | 用作用域类重写三套标记点 CSS |
| `static/js/footprint.js` | `createMarker` 生成完整 HTML |

### 不需要改动

- `FootprintRouter.java`：settings 整个对象已传入 model，自动包含新字段
- `FootprintService.java`：自动映射 settings.yaml 到 BaseConfig

---

## 使用方式

管理员在 Halo 后台 -> 插件设置 -> 基本设置 -> 标记点样式 下拉选择，保存后刷新足迹页面即可生效。

---

## 删除文件（可选）

- `footprint-A.css` / `footprint-C.css`
- `footprint-A.js` / `footprint-C.js`
