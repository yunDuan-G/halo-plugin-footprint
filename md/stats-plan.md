# 足迹统计优化方案

## 需求
1. 将"去过省级行政区"统计卡改为 `去过数量 / 总数` 格式
2. 新增按类别展示：直辖市、自治区、特别行政区、省份
3. 每个类别均显示 `去过数量 / 总数`

---

## 实现方案

### 一、省份分类规则（前端 adcode 前缀匹配）

中国省级行政区划 adcode 前两位对应类别：

| 类别 | adcode 前缀 | 总数 | 示例 |
|------|------------|------|------|
| 直辖市 | 11, 12, 31, 50 | 4 | 北京、天津、上海、重庆 |
| 自治区 | 15, 45, 54, 64, 65 | 5 | 内蒙古、广西、西藏、宁夏、新疆 |
| 特别行政区 | 81, 82 | 2 | 香港、澳门 |
| 省份 | 其余（13~71） | 23 | 广东、浙江、台湾等 |

> 总计 34 个省级行政区

### 二、前端改动（仅 `ui/src/views/Footprint.vue`）

#### 1. 新增 computed 属性

```ts
// 省级行政区类别统计
const provinceCategoryStats = computed(() => {
  if (!stats.value) return null;
  
  const categories = {
    municipality: { label: '直辖市', total: 4, prefixes: ['11', '12', '31', '50'], visited: 0 },
    autonomous:  { label: '自治区', total: 5, prefixes: ['15', '45', '54', '64', '65'], visited: 0 },
    sar:         { label: '特别行政区', total: 2, prefixes: ['81', '82'], visited: 0 },
    province:    { label: '省份', total: 23, prefixes: [], visited: 0 },
  };

  for (const p of stats.value.provinces) {
    const prefix = p.adcode?.substring(0, 2);
    if (categories.municipality.prefixes.includes(prefix)) categories.municipality.visited++;
    else if (categories.autonomous.prefixes.includes(prefix)) categories.autonomous.visited++;
    else if (categories.sar.prefixes.includes(prefix)) categories.sar.visited++;
    else categories.province.visited++;
  }

  return categories;
});
```

#### 2. 修改"去过省级行政区"卡片

将原来的大数字替换为 `去过数 / 34` 格式：

```html
<VCard class="cursor-pointer hover:shadow-md transition-shadow"
       @click="showStatsDetail = !showStatsDetail">
  <div class="p-4 text-center">
    <div class="text-3xl font-bold text-indigo-600">
      {{ stats.totalProvinces }} / 34
    </div>
    <div class="text-sm text-gray-500 mt-1">去过省级行政区</div>
  </div>
</VCard>
```

#### 3. 新增类别统计卡片行

在三个统计卡片下方新增一行，展示四个类别的小卡片：

```html
<div v-if="stats" class="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
  <div v-for="cat in provinceCategoryStats" :key="cat.label"
       class="rounded-lg border border-gray-200 bg-white p-3 text-center shadow-sm">
    <div class="text-lg font-semibold"
         :class="cat.visited > 0 ? 'text-indigo-600' : 'text-gray-400'">
      {{ cat.visited }} / {{ cat.total }}
    </div>
    <div class="text-xs text-gray-500 mt-0.5">{{ cat.label }}</div>
  </div>
</div>
```

#### 4. 详情卡片中的省份列表微调

省份详情卡片中，每条省份数据可显示所属类别标签（可选优化）。

### 三、后端改动

**不需要**。现有 `getStats()` 返回的 `StatsResult` 已包含 `provinces` 数组（含 `adcode`），前端基于 adcode 前缀分类即可。

---

## 改动范围

| 文件 | 改动内容 |
|------|---------|
| `ui/src/views/Footprint.vue` | 新增 `provinceCategoryStats` computed + 修改卡片 + 新增类别卡片行 |

---

请确认是否按此方案执行？