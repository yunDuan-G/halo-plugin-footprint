# 足迹插件 - 省份/城市/行政区划记录功能修改方案

## 1. 背景

当前足迹插件只记录了每条足迹的经纬度和地址，无法直观了解去过哪些省份、城市、直辖市、自治区、特别行政区。
项目已有 `StatsResult.java` 的 DTO 结构（定义了 `ProvinceStat`/`CityStat`），但尚未实现具体的统计 API 和数据存储。

## 2. 目标

- 在足迹记录中新增 **省级行政区**（省/直辖市/自治区/特别行政区）和 **城市** 信息
- 支持统计去过的省份和城市
- 前端展示统计概览和详情

## 3. 字段设计

| 字段 | 说明 | 示例 |
|------|------|------|
| `province` | 省级行政区名称（省/直辖市/自治区/特区） | 广东省 / 北京市 / 新疆维吾尔自治区 / 香港特别行政区 |
| `provinceAdcode` | 省级行政区编码（高德 adcode 前2位+0000） | 440000 / 110000 / 650000 / 810000 |
| `city` | 城市名称 | 深圳市 / 海淀区 |
| `cityAdcode` | 城市编码（高德 adcode） | 440300 / 110108 |

## 4. 数据流

```
足迹创建/编辑 → 填写地址 → 后端调用高德逆地理编码 → 自动填充 province/city/adcode → 存入数据库
                                                                    ↓
用户查看统计 → 调用 GET /footprints/stats → 后端按 adcode 分组聚合 → 前端展示
```

---

## 5. 后端修改（Java）

### 5.1 model/Footprint.java — 新增字段

在 `FootprintSpec` 内部类中新增 4 个字段：

```java
/**
 * 省级行政区名称（省/直辖市/自治区/特别行政区）
 */
@Schema(description = "省级行政区")
private String province;

/**
 * 城市名称
 */
@Schema(description = "城市")
private String city;

/**
 * 省级行政区编码
 */
@Schema(description = "省级行政区编码")
private String provinceAdcode;

/**
 * 城市编码
 */
@Schema(description = "城市编码")
private String cityAdcode;
```

### 5.2 新建 dto/GeoInfo.java

逆地理编码返回结果 DTO：

```java
@Data
public class GeoInfo {
    private String province;
    private String city;
    private String provinceAdcode;
    private String cityAdcode;
}
```

### 5.3 service/FootprintService.java — 新增方法签名

```java
/**
 * 逆地理编码：根据经纬度获取省/市/adcode信息
 */
Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String gaoDeWebKey);

/**
 * 获取足迹统计
 */
Mono<StatsResult> getStats();
```

### 5.4 service/impl/FootprintServiceImpl.java — 实现方法

- **reverseGeocode()**：调用高德逆地理编码 API `https://restapi.amap.com/v3/geocode/regeo`，解析返回的 `addressComponent` 中的 `province`、`city`、`adcode` 等字段
- **getStats()**：从 `ReactiveExtensionClient` 获取全部足迹，按 `provinceAdcode` / `cityAdcode` 分组并去重统计

### 5.5 FootprintEndpoint.java — 新增 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/footprints/stats` | 返回统计结果（去过 X 个省、X 个城市，各省份/城市详情列表） |
| `POST` | `/footprints/{name}/geocode` | 对指定足迹执行逆地理编码，自动填充省/市字段 |

---

## 6. 前端修改（Vue）

### 6.1 api/models.ts — 新增类型

- `FootprintSpec` 新增 `province`、`city`、`provinceAdcode`、`cityAdcode` 字段
- 新增 `StatsResult`、`ProvinceStat`、`CityStat`、`GeoInfo` 接口（对应后端 DTO）

### 6.2 api/footprint-api.ts — 新增 API 方法

```typescript
// 获取足迹统计
async getStats(): Promise<StatsResult>
// 对单条足迹执行逆地理编码
async geocodeFootprint(name: string): Promise<GeoInfo>
```

### 6.3 views/Footprint.vue — 列表和统计展示

- 表格新增 **"省份"** 列和 **"城市"** 列
- 页面顶部新增统计概览卡片区域：
  - 去过 **X** 个省级行政区
  - 去过 **X** 个城市
- 点击统计卡片可展开省份/城市详情列表

### 6.4 components/FootprintEditingModal.vue — 表单增强

- 新增 "省份" 和 "城市" 显示字段（只读展示，由逆地理编码自动填充）
- 新增 "重新解析" 按钮，触发逆地理编码更新省/市信息

---

## 7. 修改清单总览

| 序号 | 文件 | 操作 |
|------|------|------|
| 1 | `src/main/java/cc/lik/footprint/model/Footprint.java` | 修改 - FootprintSpec 新增 4 字段 |
| 2 | `src/main/java/cc/lik/footprint/dto/GeoInfo.java` | 新建 - 逆地理编码结果 DTO |
| 3 | `src/main/java/cc/lik/footprint/service/FootprintService.java` | 修改 - 新增 2 方法签名 |
| 4 | `src/main/java/cc/lik/footprint/service/impl/FootprintServiceImpl.java` | 修改 - 实现 reverseGeocode / getStats |
| 5 | `src/main/java/cc/lik/footprint/FootprintEndpoint.java` | 修改 - 新增 stats / geocode 端点 |
| 6 | `ui/src/api/models.ts` | 修改 - 新增字段和类型 |
| 7 | `ui/src/api/footprint-api.ts` | 修改 - 新增 API 方法 |
| 8 | `ui/src/views/Footprint.vue` | 修改 - 统计卡片 + 表格新增列 |
| 9 | `ui/src/components/FootprintEditingModal.vue` | 修改 - 表单新增省/市字段 |

---

## 8. 技术要点

### 逆地理编码流程

```
经纬度 (lng, lat) 
  → 高德 API: /v3/geocode/regeo?location=lng,lat&key=xxx
  → 响应: { regeocode: { addressComponent: { province, city, adcode, ... } } }
  → 解析: 
      - province = addressComponent.province  （如"广东省"、"北京市"）
      - city = addressComponent.city 或 district（直辖市时 city 为空，取 district）
      - provinceAdcode = adcode 前 2 位 + "0000"
      - cityAdcode = adcode
```

### 统计聚合逻辑

```
遍历所有足迹 
  → 按 provinceAdcode 分组 → Map<adcode, {name, count, cities}>
  → 按 cityAdcode 分组 → Map<adcode, {name, province, count}>
  → 返回 StatsResult(totalFootprints, totalProvinces, totalCities, provinces[], cities[])
```

### 省级行政区分类

所有以下类别在 `province` 字段中统一存储，通过 adcode 前缀区分：

| 类别 | 示例 | adcode 范围 |
|------|------|-------------|
| 省 | 广东省、江苏省 | 440000, 320000 |
| 直辖市 | 北京市、上海市 | 110000, 310000 |
| 自治区 | 新疆维吾尔自治区、西藏自治区 | 650000, 540000 |
| 特别行政区 | 香港特别行政区、澳门特别行政区 | 810000, 820000 |

## 9. 后续扩展建议

- 前端可配合高德 `DistrictSearch` + `Polygon` 在中国地图上高亮已去过的省份（参考 test2.md）
- 可添加 ECharts 图表展示各省份足迹数量分布
- 支持按时间范围筛选统计（本月、本年等）
