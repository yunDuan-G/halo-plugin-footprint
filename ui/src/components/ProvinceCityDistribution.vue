<script setup lang="ts">
/**
 * 省 / 市分布卡片。
 *
 * 管理页里「省 / 市分布」按钮展开的那块：省份、城市两个 Tab，共用一份搜索词；
 * 点某一项会把它写进列表的关键字筛选。数据由父级传入（同一份 stats），
 * 这里只维护 Tab、搜索词和「当前选中项」这三个纯视图状态。
 */

import { computed, ref, watch } from "vue";
import { VCard, VEmpty, VTabbar } from "@halo-dev/components";
import type { StatsResult } from "@/api/models";

interface DistributionItem {
  key: string;
  name: string;
  count: number;
  description: string;
}

const props = defineProps<{
  stats: StatsResult;
  activeRegion: string | null;
}>();

const emit = defineEmits<{
  (e: "select", name: string): void;
}>();

const tab = ref<"province" | "city">("province");
const keyword = ref("");

// 省份展示前 5 个城市名作为副标题；城市展示所属省份
const source = computed<DistributionItem[]>(() => {
  if (props.stats) {
    return tab.value === "province"
      ? props.stats.provinces.map((p) => ({
          key: p.adcode,
          name: p.name,
          count: p.count,
          description: p.cities?.length ? p.cities.slice(0, 5).join("、") : "",
        }))
      : props.stats.cities.map((c) => ({
          key: c.adcode,
          name: c.name,
          count: c.count,
          description: c.province,
        }));
  }
  return [];
});

const items = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return source.value;
  return source.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
  );
});

// 切换 Tab 时清掉搜索词，避免搜「杭州」后切到城市 Tab 还残留筛选
watch(tab, () => {
  keyword.value = "";
});
</script>

<template>
  <VCard class="fp-distribution" :body-class="['!p-0']">
    <template #header>
      <div class="fp-distribution__header">
        <p id="fp-region-hint" class="fp-distribution__hint">
          点击省份或城市可筛选下方足迹列表
        </p>
        <div class="fp-distribution__toolbar">
          <VTabbar
            v-model:active-id="tab"
            :items="[
              { id: 'province', label: `省份 ${stats.provinces.length}` },
              { id: 'city', label: `城市 ${stats.cities.length}` },
            ]"
            type="outline"
          />
          <div class="fp-distribution__search">
            <SearchInput v-model="keyword" placeholder="搜索省份或城市" />
          </div>
        </div>
      </div>
    </template>
    <div class="fp-distribution__body">
      <div id="footprint-stats-detail" class="fp-region-grid" aria-describedby="fp-region-hint">
        <button
          v-for="(item, index) in items"
          :key="item.key"
          type="button"
          class="fp-region-item"
          :class="{ 'is-active': activeRegion === item.name }"
          :aria-pressed="activeRegion === item.name"
          :aria-label="`${item.name}，${item.count} 条足迹${activeRegion === item.name ? '，已筛选' : ''}`"
          @click="emit('select', item.name)"
        >
          <span class="fp-region-item__index" aria-hidden="true">{{ index + 1 }}</span>
          <span class="fp-region-item__body">
            <strong>{{ item.name }}</strong>
            <small v-if="item.description">
              {{ item.description }}
            </small>
          </span>
          <span class="fp-region-item__count">{{ item.count }} 条</span>
        </button>
      </div>
      <VEmpty v-if="!items.length" message="没有匹配的地区" />
    </div>
  </VCard>
</template>

<style scoped>
.fp-distribution {
  margin-bottom: 1rem;
}

.fp-distribution__header {
  width: 100%;
  padding: 0.75rem 1rem;
  background: #f9fafb;
}

.fp-distribution__hint {
  margin: 0 0 0.75rem;
  color: #6b7280;
  font-size: 0.75rem;
  line-height: 1.5;
}

.fp-distribution__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
}

.fp-distribution__search {
  width: 16rem;
  max-width: 100%;
}

.fp-distribution__body {
  padding: 1rem;
}

.fp-region-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.fp-region-item {
  display: flex;
  min-width: 0;
  min-height: 3.5rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.fp-region-item:hover,
.fp-region-item:focus-visible {
  border-color: #d1d5db;
  box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.fp-region-item:focus-visible {
  outline: 2px solid var(--primary, #6366f1);
  outline-offset: 1px;
}

.fp-region-item.is-active {
  border-color: var(--primary, #6366f1);
  background: #f9fafb;
}

.fp-region-item__index {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.fp-region-item.is-active .fp-region-item__index {
  background: var(--primary, #6366f1);
  color: #fff;
}

.fp-region-item__body {
  min-width: 0;
  flex: 1;
}

.fp-region-item__body strong,
.fp-region-item__body small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-region-item__body strong {
  font-size: 0.875rem;
  font-weight: 500;
}

.fp-region-item__body small {
  margin-top: 0.15rem;
  color: #6b7280;
  font-size: 0.75rem;
}

.fp-region-item__count {
  flex: none;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.fp-region-item.is-active .fp-region-item__count {
  background: #e0e7ff;
  color: #4338ca;
}

@media (max-width: 767px) {
  .fp-distribution__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .fp-distribution__search {
    width: 100%;
  }
}

@media (max-width: 479px) {
  .fp-region-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fp-region-item {
    transition: none;
  }
}
</style>
