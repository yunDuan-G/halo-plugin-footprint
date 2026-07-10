<script setup lang="ts">
import {
  VCard,
  IconRefreshLine,
  Dialog,
  VButton,
  VEmpty,
  VLoading,
  VPagination,
  VPageHeader,
  VDropdownItem,
  Toast,
  VSpace,
  IconAddCircle,
  IconCloseCircle,
  VDropdown,
  VModal} from "@halo-dev/components";
import {useQuery, useQueryClient} from "@tanstack/vue-query";
import {computed, h, onMounted, ref, watch} from "vue";
import { formatDatetime } from "@/utils/date";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import { footprintApiClient } from "@/api";
import type {Footprint, Option, StatsResult} from "@/api/models";
import { FormKit } from "@formkit/vue";

// 定义组件名称
defineOptions({
  name: "FootprintManagement"
});

const selectedFootprint = ref<Footprint | undefined>();
const selectedFootprints = ref<string[]>([]);
const checkedAll = ref(false);
const selectedSort = ref<string | undefined>(undefined);
const selectedFootprintType = ref<string | undefined>(undefined);

const page = ref(1);
const size = ref(20);
const keyword = ref("");
const searchText = ref("");
const total = ref(0);
const editingModal = ref(false);
const showManualInput = ref(false);
const currentFootprint = ref<Footprint | null>(null);
const manualLongitude = ref("");
const manualLatitude = ref("");

// 统计相关
const statsResult = ref<StatsResult | null>(null);
const showStatsDetail = ref(false);

// 添加 queryClient
const queryClient = useQueryClient();

watch(
  () => [
    selectedSort.value,
    selectedFootprintType.value,
    keyword.value,
  ],
  () => {
    page.value = 1;
  }
);

function handleClearFilters() {
  selectedSort.value = undefined;
  selectedFootprintType.value = undefined;
}

const hasFilters = computed(() => {
  return (
    selectedSort.value ||
    selectedFootprintType.value
  );
});

function onKeywordChange() {
  keyword.value = searchText.value;
  refetch();
}

function handleReset() {
  keyword.value = "";
  searchText.value = "";
  refetch();
}

// 获取统计信息
const fetchStats = async () => {
  try {
    statsResult.value = await footprintApiClient.footprint.getStats();
  } catch (error) {
    console.error("获取统计信息失败:", error);
  }
};

const {
  data: footprints,
  isLoading,
  isFetching,
  refetch,
} = useQuery({
  queryKey: ["footprints", page, size, selectedSort, selectedFootprintType, keyword],
  queryFn: async () => {
    try {
      const response = await footprintApiClient.footprint.listFootprints({
        page: page.value,
        size: size.value,
        sort: selectedSort.value ? [selectedSort.value] : [],
        footprintType: selectedFootprintType.value,
        keyword: keyword.value,
      });
      total.value = response.total;
      return response.items;
    } catch (error) {
      console.error("获取足迹列表失败:", error);
      Toast.error("获取足迹列表失败");
      return [];
    }
  },
  refetchInterval: (data) => {
    if (!data) return false;
    // 检查是否有正在删除的足迹
    let hasDeletingFootprints = false;
    if (Array.isArray(data)) {
      hasDeletingFootprints = data.some((footprint: Footprint) => 
        footprint.metadata.deletionTimestamp !== undefined
      );
    }
    return hasDeletingFootprints ? 500 : false;
  },
});

const handleCheckAllChange = (e: Event) => {
  const { checked } = e.target as HTMLInputElement;
  checkedAll.value = checked;
  if (checkedAll.value) {
    selectedFootprints.value =
      footprints.value?.map((footprint) => {
        return footprint.metadata.name;
      }) || [];
  } else {
    selectedFootprints.value.length = 0;
  }
};

const handleDeleteInBatch = () => {
  if (selectedFootprints.value.length === 0) return;
  Dialog.warning({
    title: "是否确认删除所选的足迹",
    description: "删除之后将无法恢复此操作不可恢复。",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprints(selectedFootprints.value)
          .then(() => {
            Toast.success("删除成功");
            selectedFootprints.value.length = 0;
            checkedAll.value = false;
          });
      } catch (e) {
        console.error("删除失败", e);
        Toast.error("删除失败");
      } finally {
        refetch();
        fetchStats();
      }
    },
  });
};

const handleOpenCreateModal = (footprint: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};

const onEditingModalClose = async () => {
  selectedFootprint.value = undefined;
  refetch();
  fetchStats();
};

// 处理类型选择
const handleTypeSelect = (type: string | undefined) => {
  selectedFootprintType.value = type;
  refetch();
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
  fetchStats();
});

const handleUpdateLocation = (row: Footprint) => {
  showManualInput.value = true;
  currentFootprint.value = row;
};

const handleManualInput = async () => {
  if (!currentFootprint.value) return;
  
  const lng = parseFloat(manualLongitude.value);
  const lat = parseFloat(manualLatitude.value);
  
  if (isNaN(lng) || lng < -180 || lng > 180) {
    Toast.error("请输入有效的经度（-180到180）");
    return;
  }
  if (isNaN(lat) || lat < -90 || lat > 90) {
    Toast.error("请输入有效的纬度（-90到90）");
    return;
  }
  
  currentFootprint.value.spec.longitude = lng;
  currentFootprint.value.spec.latitude = lat;
  
  try {
    await footprintApiClient.footprint.updateFootprint(
      currentFootprint.value.metadata.name,
      currentFootprint.value
    );
    // 自动逆地理编码填充省/市信息
    await footprintApiClient.footprint.geocodeFootprint(currentFootprint.value.metadata.name);
    Toast.success("经纬度更新成功，省/市信息已自动填充");
    showManualInput.value = false;
    refetch();
    fetchStats();
  } catch (error) {
    console.error("更新失败:", error);
    Toast.error("更新失败");
  }
};

// 为足迹执行逆地理编码
const handleGeocodeFootprint = async (row: Footprint) => {
  try {
    await footprintApiClient.footprint.geocodeFootprint(row.metadata.name);
    Toast.success("省/市信息填充成功");
    refetch();
    fetchStats();
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  }
};

const handleEdit = (row: Footprint) => {
  currentFootprint.value = row;
  editingModal.value = true;
};
</script>

<template>
  <div>
    <!-- 统计概览卡片 -->
    <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <VCard :body-class="['!p-4']">
        <div class="flex items-center gap-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
            <svg class="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-900">{{ statsResult?.totalFootprints ?? 0 }}</p>
            <p class="text-sm text-gray-500">足迹总数</p>
          </div>
        </div>
      </VCard>

      <VCard :body-class="['!p-4']">
        <div class="flex items-center gap-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
            <svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-900">{{ statsResult?.totalProvinces ?? 0 }}</p>
            <p class="text-sm text-gray-500">去过省级行政区</p>
          </div>
        </div>
      </VCard>

      <VCard :body-class="['!p-4']">
        <div class="flex items-center gap-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
            <svg class="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-900">{{ statsResult?.totalCities ?? 0 }}</p>
            <p class="text-sm text-gray-500">去过城市</p>
          </div>
        </div>
      </VCard>
    </div>

    <!-- 省份/城市详情（可展开） -->
    <VCard v-if="statsResult && showStatsDetail" :body-class="['!p-4']" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium text-gray-900">统计详情</h3>
          <VButton size="sm" @click="showStatsDetail = false">收起</VButton>
        </div>
      </template>
      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <!-- 省份列表 -->
        <div>
          <h4 class="mb-3 text-sm font-semibold text-gray-700">省级行政区 ({{ statsResult.totalProvinces }})</h4>
          <div class="max-h-80 overflow-y-auto space-y-2">
            <div
              v-for="province in statsResult.provinces"
              :key="province.adcode"
              class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
            >
              <span class="text-sm font-medium text-gray-800">{{ province.name }}</span>
              <span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {{ province.count }} 个足迹
              </span>
            </div>
          </div>
        </div>
        <!-- 城市列表 -->
        <div>
          <h4 class="mb-3 text-sm font-semibold text-gray-700">城市 ({{ statsResult.totalCities }})</h4>
          <div class="max-h-80 overflow-y-auto space-y-2">
            <div
              v-for="city in statsResult.cities"
              :key="city.adcode"
              class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
            >
              <div>
                <span class="text-sm font-medium text-gray-800">{{ city.name }}</span>
                <span class="ml-2 text-xs text-gray-400">{{ city.province }}</span>
              </div>
              <span class="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                {{ city.count }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </VCard>

    <VCard class="h-full" :body-class="['!p-0']">
      <template #header>
        <div class="block sm:flex items-center w-full">
          <div class="flex w-full flex-1 items-center sm:w-auto">
            <VSpace align="center">
              <FormKit
                v-if="!selectedSort"
                v-model="searchText"
                :placeholder="`输入关键词搜索...`"
                type="text"
                outer-class="!p-0"
                wrapper-class="!p-0"
                inner-class="!border-none !p-0 h-8 !w-64"
                @keyup.enter="onKeywordChange"
              ></FormKit>
              <VButton v-else size="sm" @click="handleReset">
                重置
              </VButton>
            </VSpace>
          </div>
          <div class="mt-0 flex w-full flex-1 items-center justify-end gap-2 sm:flex-row sm:gap-3">
            <!-- 统计详情按钮 -->
            <VButton v-if="statsResult" size="sm" @click="showStatsDetail = !showStatsDetail">
              {{ showStatsDetail ? '收起统计' : '统计详情' }}
            </VButton>
            <FilterDropdown
              v-model="selectedSort"
              :items="[
                {label: '较新的在前', value: 'creationTimestamp,desc'},
                {label: '较旧的在前', value: 'creationTimestamp,asc'},
              ]"
              label="排序"
            />
            <FilterDropdown
              v-model="selectedFootprintType"
              :items="footprintTypes.map(type => ({label: type.label, value: type.value}))"
              label="类型"
            />
            <FilterCleanButton v-if="hasFilters" @click="handleClearFilters" />
            <VDropdown v-permission="['system:posts:manage']">
              <VButton size="sm"> 批量操作 </VButton>
              <template #popper>
                <VDropdownItem type="danger" @click="handleDeleteInBatch">
                  批量删除
                </VDropdownItem>
              </template>
            </VDropdown>
            <VButton
              v-permission="['system:posts:manage']"
              size="sm"
              type="secondary"
              @click="handleOpenCreateModal({} as Footprint)"
            >
              <template #icon>
                <IconAddCircle class="h-full w-full" />
              </template>
              新增
            </VButton>
            <div
              class="flex cursor-pointer items-center rounded p-1.5 text-sm transition-all hover:bg-gray-100"
              @click="refetch && refetch()"
            >
              <IconRefreshLine
                :class="{ 'animate-spin text-gray-900': isFetching }"
                class="h-4 w-4 cursor-pointer text-gray-600"
              />
            </div>
          </div>
        </div>
      </template>

      <VLoading v-if="isLoading" />

      <Transition
        v-else-if="!footprints || footprints.length === 0"
        appear
        name="fade"
      >
        <VEmpty message="没有数据，请尝试清空部分筛选条件" title="暂无足迹">
          <template #actions>
            <VSpace>
              <VButton @click="handleOpenCreateModal({} as Footprint)"> 新增 </VButton>
            </VSpace>
          </template>
        </VEmpty>
      </Transition>

      <Transition v-else appear name="fade"><div class="overflow-x-auto max-h-[calc(100vh-24rem)] overflow-y-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left" scope="col">
                <input
                  v-model="checkedAll"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  name="post-checkbox"
                  type="checkbox"
                  @change="handleCheckAllChange"
                />
              </th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹名称 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">预览图 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹类型 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">省份 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">城市 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">经度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">纬度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">地址 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">创建时间 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center"> </div></th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="footprint in footprints" :key="footprint.metadata.name" class="border-b last:border-none hover:bg-gray-100">
              <td class="px-4 py-4">
                <input
                  v-model="selectedFootprints"
                  :value="footprint.metadata.name"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  name="post-checkbox"
                  type="checkbox"
                />
              </td>
              <td class="px-4 py-4">{{footprint.spec.name}}</td>
              <td class="px-4 py-4 poster">
                <img v-if="footprint.spec.image" :src="footprint.spec.image" class="h-16 w-auto object-cover rounded">
              </td>
              <td class="px-4 py-4 table-td">{{footprint.spec.footprintType}}</td>
              <td class="px-4 py-4 table-td">
                <span v-if="footprint.spec.province" class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                  {{ footprint.spec.province }}
                </span>
                <span v-else class="text-xs text-gray-400">未解析</span>
              </td>
              <td class="px-4 py-4 table-td">
                <span v-if="footprint.spec.city" class="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
                  {{ footprint.spec.city }}
                </span>
                <span v-else class="text-xs text-gray-400">未解析</span>
              </td>
              <td class="px-4 py-4 table-td">{{footprint.spec.longitude}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.latitude}}</td>
              <td class="px-4 py-4">{{footprint.spec.address}}</td>
              <td class="px-4 py-4 table-td">{{formatDatetime(footprint.spec.createTime)}}</td>
              <td class="px-4 py-4 table-td">
                <VDropdown>
                  <button
                    type="button"
                    class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    操作
                  </button>
                  <template #popper>
                    <div class="w-36 max-h-60 overflow-auto">
                      <VDropdownItem @click="handleEdit(footprint)">
                        编辑
                      </VDropdownItem>
                      <VDropdownItem @click="handleUpdateLocation(footprint)">
                        更新经纬度
                      </VDropdownItem>
                      <VDropdownItem @click="handleGeocodeFootprint(footprint)">
                        解析省/市
                      </VDropdownItem>
                    </div>
                  </template>
                </VDropdown>
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </Transition>

      <template #footer>
        <VPagination
          v-model:page="page"
          v-model:size="size"
          :total="total"
          :size-options="[20, 30, 50, 100]"
        />
      </template>
    </VCard>

    <FootprintEditingModal
      v-model:visible="editingModal"
      :footprint="currentFootprint ?? undefined"
      @close="onEditingModalClose"
    />
  </div>

  <!-- 手动输入经纬度的对话框 -->
  <Teleport to="body">
    <VModal
      v-model:visible="showManualInput"
      :width="500"
      title="手动更新经纬度"
      :mask-closable="false"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">经度</label>
          <input
            type="number"
            v-model="manualLongitude"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入经度（-180到180）"
            step="0.000001"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">纬度</label>
          <input
            type="number"
            v-model="manualLatitude"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入纬度（-90到90）"
            step="0.000001"
          />
        </div>
      </div>
      <template #footer>
        <VSpace>
          <VButton
            type="secondary"
            @click="showManualInput = false"
          >
            取消
          </VButton>
          <VButton
            type="primary"
            @click="handleManualInput"
          >
            确定
          </VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>
</template>

<style scoped lang="scss">
.widefat * {
  word-wrap: break-word;
}

.poster img {
  width: 64px;
  height: 64px;
  border-radius: 4px;
  object-fit: cover;
}

.table-td {
  white-space: nowrap;
}
</style>
