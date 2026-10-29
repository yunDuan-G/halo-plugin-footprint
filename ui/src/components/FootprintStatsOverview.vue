<script setup lang="ts">
/**
 * 足迹管理页顶部的三栏统计概览。
 *
 * 这是合并前统计卡的恢复版。样式全部收在组件内，不依赖控制台预构建产物
 * 是否包含某个 Tailwind 工具类，避免插件升级后统计区突然退化成无样式文字。
 */
import { computed } from "vue";
import type { StatsResult } from "@/api/models";
import {
  TOTAL_PROVINCES,
  coverageRate,
  provinceCategoryStats,
  provinceCoverageRate,
} from "@/utils/province-coverage";

const props = defineProps<{
  stats: StatsResult;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-details"): void;
}>();

const overallRate = computed(() => provinceCoverageRate(props.stats.totalProvinces));
const categories = computed(() => provinceCategoryStats(props.stats.provinces));
</script>

<template>
  <section class="fp-stats" aria-label="足迹统计概览">
    <div class="fp-stats__grid">
      <article class="fp-stats__summary">
        <span class="fp-stats__accent" aria-hidden="true"></span>
        <div class="fp-stats__heading">
          <div>
            <p class="fp-stats__eyebrow">Footprint index</p>
            <h2>足迹总览</h2>
          </div>
          <button
            type="button"
            class="fp-stats__detail-button"
            :aria-expanded="expanded"
            aria-controls="footprint-stats-detail"
            @click="emit('toggle-details')"
          >
            {{ expanded ? "收起详情" : "查看详情" }}
          </button>
        </div>
        <div class="fp-stats__total-row">
          <strong class="fp-stats__total">{{ stats.totalFootprints }}</strong>
          <span>条足迹记录</span>
        </div>
        <p class="fp-stats__coverage">
          <i aria-hidden="true"></i>
          覆盖 {{ stats.totalProvinces }} 个省级行政区 · {{ stats.totalCities }} 个城市
        </p>
      </article>

      <article class="fp-stats__panel">
        <div class="fp-stats__panel-head">
          <div>
            <h3>省份覆盖</h3>
            <p>全国省级行政区</p>
          </div>
          <span>{{ stats.totalProvinces }} / {{ TOTAL_PROVINCES }}</span>
        </div>
        <div class="fp-stats__metric">
          <strong>{{ overallRate }}%</strong>
          <span>覆盖率</span>
        </div>
        <div
          class="fp-progress"
          role="progressbar"
          :aria-valuenow="overallRate"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="省份覆盖率"
        >
          <div class="fp-progress__bar" :style="{ width: `${overallRate}%` }"></div>
        </div>
      </article>

      <article class="fp-stats__panel">
        <div class="fp-stats__panel-head">
          <div>
            <h3>已到访城市</h3>
            <p>按城市编码去重</p>
          </div>
          <span class="fp-stats__tag">城市</span>
        </div>
        <div class="fp-stats__metric">
          <strong>{{ stats.totalCities }}</strong>
          <span>个</span>
        </div>
        <p class="fp-stats__coverage">
          <i aria-hidden="true"></i>
          把走过的城市，慢慢连成自己的旅行版图
        </p>
      </article>
    </div>

    <div class="fp-stats__categories">
      <div class="fp-stats__categories-head">
        <div>
          <h3>行政区类型</h3>
          <p>按省级行政区类别统计</p>
        </div>
        <span>已覆盖 / 总数</span>
      </div>
      <div class="fp-stats__category-grid">
        <div v-for="category in categories" :key="category.key" class="fp-category">
          <div class="fp-category__label">
            <span>{{ category.label }}</span>
            <strong>{{ category.visited }} / {{ category.total }}</strong>
          </div>
          <div
            class="fp-progress fp-progress--compact"
            role="progressbar"
            :aria-valuenow="coverageRate(category.visited, category.total)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${category.label}覆盖率`"
          >
            <div
              class="fp-progress__bar"
              :style="{ width: `${coverageRate(category.visited, category.total)}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fp-stats {
  margin-bottom: 1rem;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.fp-stats__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fp-stats__summary {
  position: relative;
  padding: 1.5rem;
  background: rgb(248 250 252 / 80%);
  border-right: 1px solid #e5e7eb;
}

.fp-stats__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: #6366f1;
}

.fp-stats__heading,
.fp-stats__panel-head,
.fp-stats__categories-head,
.fp-category__label {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.fp-stats__eyebrow {
  margin: 0;
  color: #4f46e5;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.fp-stats h2,
.fp-stats h3,
.fp-stats p {
  margin: 0;
}

.fp-stats h2 {
  margin-top: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.fp-stats__detail-button {
  min-height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  color: #4b5563;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.fp-stats__detail-button:hover,
.fp-stats__detail-button:focus-visible {
  border-color: #c7d2fe;
  background: #eef2ff;
  color: #4338ca;
}

.fp-stats__total-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  margin-top: 1.75rem;
  color: #6b7280;
  font-size: 0.875rem;
}

.fp-stats__total {
  color: #030712;
  font-size: 3.75rem;
  font-weight: 600;
  line-height: 0.9;
  letter-spacing: -0.06em;
  font-variant-numeric: tabular-nums;
}

.fp-stats__coverage {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.25rem !important;
  color: #6b7280;
  font-size: 0.75rem;
  line-height: 1.5;
}

.fp-stats__coverage i {
  width: 0.5rem;
  height: 0.5rem;
  flex: none;
  border-radius: 999px;
  background: #6366f1;
}

.fp-stats__panel {
  padding: 1.5rem;
  border-right: 1px solid #e5e7eb;
}

.fp-stats__panel:last-child {
  border-right: 0;
}

.fp-stats__panel-head h3 {
  color: #6b7280;
  font-size: 0.875rem;
  font-weight: 500;
}

.fp-stats__panel-head p,
.fp-stats__categories-head p {
  margin-top: 0.25rem !important;
  color: #9ca3af;
  font-size: 0.75rem;
}

.fp-stats__panel-head > span {
  color: #111827;
  font-size: 0.875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.fp-stats__tag {
  color: #4f46e5 !important;
  font-size: 0.75rem !important;
  font-weight: 500 !important;
}

.fp-stats__metric {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-top: 1.75rem;
}

.fp-stats__metric strong {
  color: #030712;
  font-size: 1.875rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}

.fp-stats__metric span {
  color: #9ca3af;
  font-size: 0.75rem;
}

.fp-progress {
  height: 8px;
  margin-top: 1rem;
  overflow: hidden;
  border-radius: 999px;
  background: #f3f4f6;
}

.fp-progress--compact {
  height: 6px;
  margin-top: 0.5rem;
}

.fp-progress__bar {
  height: 100%;
  border-radius: inherit;
  background: #6366f1;
  transition: width 300ms ease;
}

.fp-stats__categories {
  padding: 1.25rem 1.5rem;
  border-top: 1px solid #e5e7eb;
}

.fp-stats__categories-head {
  align-items: center;
}

.fp-stats__categories-head h3 {
  color: #374151;
  font-size: 0.875rem;
  font-weight: 500;
}

.fp-stats__categories-head > span {
  color: #9ca3af;
  font-size: 0.75rem;
}

.fp-stats__category-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.5rem;
  margin-top: 1rem;
}

.fp-category__label {
  align-items: center;
  color: #6b7280;
  font-size: 0.75rem;
}

.fp-category__label strong {
  flex: none;
  color: #111827;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1023px) {
  .fp-stats__category-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .fp-stats__grid {
    grid-template-columns: 1fr;
  }

  .fp-stats__summary,
  .fp-stats__panel {
    border-right: 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .fp-stats__panel:last-child {
    border-bottom: 0;
  }
}

@media (max-width: 639px) {
  .fp-stats__category-grid {
    grid-template-columns: 1fr;
    gap: 0.875rem;
  }

  .fp-stats__summary,
  .fp-stats__panel {
    padding: 1.25rem;
  }

  .fp-stats__total {
    font-size: 3rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fp-progress__bar,
  .fp-stats__detail-button {
    transition: none;
  }
}
</style>
