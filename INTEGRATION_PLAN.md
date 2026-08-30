# `/footprints` 地球首页 + 2D 高德地图 整合方案

> 状态：方案设计稿（尚未修改任何代码）
> 目标：访问 `/footprints` 时默认展示 `test/` 中的 Cesium 3D 地球；点击导航栏 2D/3D 切换按钮进入 2D 时，加载本项目原有的高德地图页面。

---

## 1. 背景与现状

### 1.1 项目现状（2D 高德地图）

| 文件 | 作用 |
| --- | --- |
| `src/main/java/cc/lik/footprint/FootprintRouter.java` | 注册 `GET /footprints` 路由，读取配置和足迹数据，渲染 Thymeleaf 模板 `footprint` |
| `src/main/resources/templates/footprint.html` | 页面模板：注入高德 JS API、`window.FOOTPRINT_CONFIG`（足迹 + 设置），包含 `#footprint-map` 容器及时间线、照片墙、统计面板等 UI |
| `src/main/resources/static/js/footprint.js` | 高德地图逻辑：`new AMap.Map('footprint-map', ...)`（约 3098 行）、足迹标记、城市高亮、时间线、照片墙等 |
| `src/main/resources/static/css/footprint.css` | 高德页面样式，以 `#footprint-page` 为根作用域 |
| `src/main/java/cc/lik/footprint/FootprintHeadProcessor.java` | 向所有主题页面注入 `footprint.css/js`（`footprint.js` 内部通过路径守卫只在 `/footprints` 生效） |
| `src/main/resources/extensions/reverseProxy.yaml` | 将 `src/main/resources/static/**` 以 `/plugins/footprint/assets/static/**` 对外提供 |
| `ui/` | Halo 后台管理端（足迹 CRUD），与访客页面 `/footprints` 无直接关系 |

当前 `/footprints` 页面是纯高德 JS API 2D 地图。

### 1.2 test/ 现状（3D 地球）

| 文件 | 作用 |
| --- | --- |
| `test/test.html` | 页面外壳：Cesium 容器、顶部导航栏（2D/3D、自动旋转、城市高亮、三维地形、底图下拉）、相册/城市/灯箱/详情卡等 UI |
| `test/app.js` | 全部 Cesium 逻辑（约 100KB）：初始化 Viewer、底图 Provider、坐标转换、足迹数据加载、标记/聚合、2D/3D 切换等 |
| `test/style.css` | 地球页面样式（约 95KB） |
| `test/cesium/` | Cesium 1.120 本地构建（374 个文件，约 11.2MB；`Cesium.js` 4.84MB + `Workers/Assets/ThirdParty/Widgets`） |
| `test/vendor/` | `pako.min.js`、`tdtplug.umd.min.js`（天地图地形插件依赖） |
| `test/100000_full.json` | 中国轮廓 GeoJSON（约 0.56MB） |
| `test/test.json` | 测试用足迹数据（Footprint CRD 数组），整合后不再需要 |

关键点：

- `test.html` 的 2D/3D 按钮（`#sceneModeBtn`）目前调用 Cesium 自身的 `viewer.scene.morphTo2D() / morphTo3D()`，即 Cesium 平面 2D，**不是**项目原有的高德地图。
- `app.js` 目前通过 `fetch('test.json')` 加载数据，内置了兜底数据；坐标统一视为 GCJ-02（高德火星坐标）。
- `app.js` 底部通过 `./100000_full.json`（相对当前页面 URL）加载中国轮廓。

---

## 2. 目标

1. `GET /footprints` 默认展示 3D 地球（Cesium，首页即整球视图）。
2. 顶部导航栏保留 2D/3D 切换按钮：
   - 3D 状态点击“2D” → 加载并展示**项目原有的高德地图页面**（时间线、照片墙、城市高亮、统计等原有功能全部保留）；
   - 2D 状态点击“3D” → 回到地球视图。
3. 两视图共用同一份足迹数据（沿用 Thymeleaf 注入的 `window.FOOTPRINT_CONFIG.footprints`）。

---

## 3. 方案设计

### 3.1 方案 A（推荐）：单页双视图，2D 高德地图懒加载

`/footprints` 仍是同一个模板、同一个 URL，页面内同时存在两个视图容器：

- `#view-3d`：Cesium 地球 + 地球专属 UI（导航栏、整球按钮、标记详情卡、相册、城市视图、灯箱等），默认显示；
- `#view-2d`：原 `footprint.html` 的高德地图 DOM（`#footprint-map` + 时间线/照片墙/统计/留言板等），默认隐藏，首次切换到 2D 时才初始化高德地图。

切换流程：

```
默认进入 /footprints
   └── 3D 视图可见，Cesium 初始化，高德地图未初始化
        └── 点击导航栏 2D
             ├── 隐藏 #view-3d（暂停/停止自转等 3D 动画）
             ├── 显示 #view-2d
             ├── 首次：调用高德初始化（复用 footprint.js 的 initializeApp）
             └── 非首次：map.resize() + 恢复
        └── 点击导航栏 3D
             ├── 隐藏 #view-2d
             └── 显示 #view-3d，恢复自转/视角
```

优点：

- 切换即时、无页面跳转，体验最接近“切换按钮”的语义；
- 复用现有 `footprint.js` 全部功能，改动集中在“延迟初始化 + 显隐控制”；
- 路由、数据注入、后端代码零改动。

缺点：

- 两个样式表同时存在，需要做作用域隔离（见 §5.4）；
- 首次切换 2D 时有高德 JS API 与地图初始化耗时（懒加载即为此设计，可接受）；
- 页面 DOM 较大（两个视图并存）。

### 3.2 方案 B（备选）：双路由 `/footprints` 与 `/footprints/2d`

- `/footprints` → 地球模板（新模板）；`/footprints/2d` → 原高德模板。
- 导航栏按钮改为页面跳转链接。

优点：两个页面完全独立，零 CSS/DOM 冲突，改动最小、风险最低。

缺点：切换是整页跳转，无法保留 3D 视角/自转状态，体验不如按钮式切换；需要后端新增一条路由，且 URL 语义变化。

**结论：优先采用方案 A**；若实施中样式/行为冲突难以收敛，方案 B 作为降级兜底。

---

## 4. 实施步骤

### 4.1 静态资源落地（test → 插件）

将 `test/` 中地球相关资源复制到 `src/main/resources/static/`（保持目录结构完整）：

| 源 | 目标 | 说明 |
| --- | --- | --- |
| `test/cesium/` | `static/cesium/` | 整目录复制（374 文件 / 约 11.2MB）。`Cesium.js` 通过相对路径加载 `Workers/`、`Assets/`、`ThirdParty/`、`Widgets/`，目录结构必须原样保留 |
| `test/vendor/pako.min.js` | `static/vendor/pako.min.js` | 天地图地形解压依赖 |
| `test/vendor/tdtplug.umd.min.js` | `static/vendor/tdtplug.umd.min.js` | 天地图地形 Provider |
| `test/style.css` | `static/css/travel-memory.css` | 重命名，避免与 `footprint.css` 混淆 |
| `test/app.js` | `static/js/travel-memory.js` | 重命名并做 §4.3 的改造 |
| `test/100000_full.json` | `static/data/china-full.json` | 中国轮廓数据 |
| `test/test.html` 中的地球 UI 结构 | 合并进 `templates/footprint.html` | 见 §4.2 |

不需要复制：`test/test.json`（数据改由 `FOOTPRINT_CONFIG` 注入）、`test/test-bak.html`、`test/_probe_s8scl.png`。

资源通过现有 `reverseProxy.yaml`（`/static/**` → `static/` 目录）自动以 `/plugins/footprint/assets/static/**` 提供，无需新增反代规则。

### 4.2 模板改造（`templates/footprint.html`）

保留原有内容：

- `<head>` 中的 `_AMapSecurityConfig`（`settings.gaoDeKey`）与高德 JS API 2.0 引入脚本——2D 模式必需；
- Thymeleaf 注入的 `window.FOOTPRINT_CONFIG`（足迹数据 + 全部设置项）；
- 原 `footprint.html` body 中的高德 UI 结构（`#footprint-map`、照片墙、统计、控件、时间线抽屉、留言板等）。

新增内容：

- `<head>` 追加：
  - `/plugins/footprint/assets/static/cesium/Widgets/widgets.css`
  - `/plugins/footprint/assets/static/cesium/Cesium.js`
  - `/plugins/footprint/assets/static/vendor/pako.min.js`
  - `/plugins/footprint/assets/static/vendor/tdtplug.umd.min.js`
  - `/plugins/footprint/assets/static/css/travel-memory.css`
- body 改为两个视图包裹层：
  - `#view-3d`：`#cesiumContainer` + 地球导航栏/UI（从 `test.html` 迁移）；
  - `#view-2d`：原高德 UI 全部放入。
- 导航栏只保留一套：`#topNav` + `#sceneModeBtn`（2D/3D）、自动旋转、城市高亮、三维地形、底图下拉。高德页原有操作控件（时间线、照片墙等）保留在 `#view-2d` 内，进入 2D 后自然可用。
- body 末尾追加 `<script src="/plugins/footprint/assets/static/js/travel-memory.js"></script>`。

注意事项：

- `travel-memory.css/js` **不要**通过 `FootprintHeadProcessor` 全局注入（否则所有主题页面都会加载 11MB Cesium）。只在 `footprint.html` 内直接引用。
- `FootprintHeadProcessor` 对 `footprint.css/js` 的全局注入保持不变（`footprint.js` 有路径守卫，非 `/footprints` 页面无副作用）。

### 4.3 `travel-memory.js` 改造点（由 app.js 改造）

1. **数据源替换**：删除 `fetch('test.json')` 逻辑，改为读取 `window.FOOTPRINT_CONFIG.footprints`：
   - 复用现有 `mapTestJsonEntry` 的字段映射（name/description/lng/lat/city/省市编码/type/图片/游记链接等）；
   - `createTime` 处理兼容 ISO 格式（`2026-01-05T01:04:00Z`，现有 `formatTestDate` 只处理 `MM/DD/YYYY`，需补充）；
   - 坐标仍按 GCJ-02 处理（现有 `coordType: 'gcj02'`），与高德来源数据一致；
   - 无数据时保留内置兜底数组并在控制台告警。
2. **中国轮廓路径**：`./100000_full.json` 改为绝对路径 `/plugins/footprint/assets/static/data/china-full.json`（页面 URL 是 `/footprints`，相对路径会解析到站点根目录）。
3. **2D/3D 切换改造**（替换 `app.js` 约 343–420 行的 `morphTo2D/morphTo3D` 逻辑）：
   - 移除 Cesium `morphTo2D` 及相关 2D 相机动画（`animateCameraToRect`、`CHINA_VIEW`、`morphComplete` 中的 2D 分支）；
   - 点击 2D：隐藏 `#view-3d`、显示 `#view-2d`、按钮文字置为“3D”，并触发高德初始化（见 §4.4）；
   - 点击 3D：隐藏 `#view-2d`、显示 `#view-3d`、按钮文字置为“2D”，恢复自转（`prefers-reduced-motion` 时除外）；
   - 地球侧状态：进入 2D 时停止自动旋转与 `requestAnimationFrame` 循环，避免后台渲染消耗；返回 3D 时恢复。
4. **品牌文案接入设置**：`#topNav` 的 “旅行记忆 / Travel Memory”、`#pageIntro` 标题与描述，改用 `FOOTPRINT_CONFIG.title/logoName/describe`（现有为硬编码）。
5. **状态栏**：2D 状态下可将 `#statusText` 文案切换为“高德 2D 地图”，3D 下保持现有底图/坐标文案。
6. `aria-busy`、瓦片错误重试等逻辑保持不变。

### 4.4 `footprint.js` 改造点（高德地图改为可懒加载）

1. **暴露初始化接口**（二选一）：
   - 推荐：`window.Footprint2D = { init(config), destroy(), isInitialized }`；
   - 或监听自定义事件：`document.addEventListener('footprint:show2d', ...)`，由 `travel-memory.js` 派发。
2. **延迟初始化**：现有 `DOMContentLoaded → checkAMap → initializeApp` 改为：
   - 非 `/footprints` 路径仍直接 return（守卫保留）；
   - `/footprints` 下不再自动初始化，只在首次切换到 2D 时执行；
   - `initializeApp` 增加幂等保护（已初始化则只 `map.resize()`）。
3. **销毁/恢复**：
   - 提供 `destroy()`（或显隐控制）：移除标记/图层/事件监听、取消时间线动画与 `requestAnimationFrame`；
   - 切回 3D 时调用；再次进入 2D 时可选择重新初始化或仅 `map.resize()`（推荐首次初始化后保留实例、只做显隐，避免反复重建高德地图的耗时）。
4. **容器尺寸**：`#view-2d` 从 `display:none` 变为可见后调用 `map.resize()`（`initializeApp` 已启用 `resizeEnable`）。
5. 高德地图的所有原有功能（时间线、照片墙、城市高亮、留言板、统计、全屏等）逻辑不动。

### 4.5 CSS 隔离

两个样式表都有 `html/body` 级全局规则（`overflow:hidden`、背景、字体），直接共存会互相污染：

- `travel-memory.css`：把 `html, body, #cesiumContainer { ... }` 等全局规则改为 `body.mode-3d ...` 作用域；
- `footprint.css`：其根选择器已是 `#footprint-page`，全局规则较少；将 body 级规则限定在 `body.mode-2d`；
- `travel-memory.js` 切换视图时同步切换 `document.body` 的 `mode-3d / mode-2d` 类。

两个视图的 DOM ID 经核对无重叠（地球：`cesiumContainer/topNav/status/markerCard/albumOverlay/cityView/lightbox/pageIntro` 等；高德：`footprint-map/map-stats/map-controls/timelineDrawer/photo-wall-layer/messageBoards` 等），仍建议用 `#view-3d` / `#view-2d` 包裹并互斥显隐，双保险。

### 4.6 后端

- `FootprintRouter`、`FootprintEndpoint`、`FootprintHeadProcessor` 均**无需改动**；
- 数据继续由 Thymeleaf 在 `footprint.html` 注入（已按创建时间倒序），不新增 API；
- 可选项（本期不做）：后续若需要“新增足迹后页面实时刷新”，可改为调用现有 `GET /apis/api.footprint.lik.cc/v1alpha1/footprints`。

---

## 5. 风险与注意事项

| 风险/注意点 | 说明与对策 |
| --- | --- |
| Cesium 相对路径加载 | `Cesium.js` 依赖同目录 `Workers/Assets/ThirdParty/Widgets`，必须整目录原样放入 `static/cesium/`；由 Halo 反向代理同源提供，Worker 可正常加载 |
| 插件体积增加约 12MB | 首次访问加载较慢；Halo 侧一般会启用压缩，可接受。若后续体积敏感，可考虑 Cesium 精简构建或 CDN（但 CDN 会引入跨域/可用性风险，默认不用） |
| 高德 Key | 2D 模式依赖 `settings.gaoDeKey`（JS API + 域名白名单）；3D 瓦片走高德公开瓦片 URL 不依赖 Key。`_AMapSecurityConfig` 必须保留 |
| 坐标系统 | 足迹数据为 GCJ-02：高德 2D 直接用原坐标；Cesium 高德底图也是 GCJ-02 瓦片，`app.js` 已有 WGS84 ↔ GCJ-02 转换，切天地图底图时已有处理，无需额外改动 |
| 样式冲突 | 两个样式表共存，按 §4.5 做 `mode-2d/mode-3d` 作用域隔离 |
| 内存与性能 | 3D 隐藏时停止自转/动画循环；2D 首次初始化后保留实例，仅显隐切换；如发现内存占用高，可对 2D 实施销毁重建 |
| 移动端 | 两个视图各自已有响应式/移动端适配；验收时需覆盖手机端切换 |
| 主题模板覆盖 | `TemplateNameResolver` 允许主题覆盖 `footprint` 模板，若当前主题有同名模板会优先；实施前需确认站点实际生效的模板 |
| 其他主题页面 | `travel-memory.css/js` 只在 `footprint.html` 内引用，不得全局注入，避免无关页面加载 Cesium |
| 许可证 | Cesium 1.120 为 Apache-2.0，与插件 GPL-3.0 兼容；`test/` 中如含许可证文件建议一并保留说明 |
| 高德 JS API 与 Cesium 并存 | 两者均为全局对象（`AMap`、`Cesium`），命名无冲突；高德脚本在 head 加载（2D 需要），Cesium 在 head 加载，均同步阻塞，首屏体感可通过脚本 `defer`/按需注入优化（本期可先保持同步） |

---

## 6. 验收清单

1. 访问 `/footprints` 默认显示 3D 地球整球视图，足迹城市聚合/标记、中国轮廓、自动旋转可用。
2. 点击导航栏“2D”切换到项目原有高德地图：地图加载成功，时间线、照片墙、统计面板、城市高亮、留言板等原有功能可用。
3. 点击“3D”切回地球，自转恢复，视角合理（回到整球/中国范围）。
4. 两视图足迹数据一致（数量、城市、名称、图片一致），来自同一 `FOOTPRINT_CONFIG`。
5. 刷新页面后默认仍是 3D 地球；3D 底图选择/自动旋转的 localStorage 记忆只影响 3D 视图。
6. 站内其他主题页面（非 `/footprints`）不受影响：不加载 Cesium 资源，原有页面样式/脚本无回归。
7. 桌面端与移动端均可完成 2D/3D 切换。
8. 2D 高德地图 Key 失效时：3D 地球仍可正常显示，2D 切换给出清晰报错（沿用现有 AMap 加载失败提示）。

---

## 7. 实施顺序建议

1. 复制静态资源（§4.1），在本地以最小改动让 `/footprints` 先跑通 3D 地球（模板指向新资源，数据先用 `FOOTPRINT_CONFIG`）；
2. 完成 `travel-memory.js` 数据源与 2D/3D 切换改造（§4.3）；
3. 完成 `footprint.js` 懒加载接口（§4.4）；
4. CSS 作用域隔离与联调（§4.5）；
5. 按 §6 全量验收，处理移动端与异常场景。
