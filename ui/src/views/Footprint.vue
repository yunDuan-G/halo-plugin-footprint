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

const showStatsDetail = ref(false);

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
    let hasDeletingFootprints = false;
    if (Array.isArray(data)) {
      hasDeletingFootprints = data.some((footprint: Footprint) => 
        footprint.metadata.deletionTimestamp !== undefined
      );
    }
    return hasDeletingFootprints ? 500 : false;
  },
});

const stats = ref<StatsResult | null>(null);

const fetchStats = async () => {
  try {
    const result = await footprintApiClient.footprint.getStats();
    if (result) {
      // 按数量倒序排列
      result.provinces.sort((a, b) => b.count - a.count);
      result.cities.sort((a, b) => b.count - a.count);
      stats.value = JSON.parse(JSON.stringify(result));
    }
  } catch (error) {
    console.error("获取足迹统计失败:", error);
  }
};

fetchStats();

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

const handleDeleteInBatch = async () => {
  if (selectedFootprints.value.length === 0) return;

  const names = [...selectedFootprints.value];
  Dialog.warning({
    title: "是否确认删除所选的足迹",
    description: "删除之后将无法恢复此操作不可恢复。",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprints(names);
        Toast.success("删除成功");
        selectedFootprints.value.length = 0;
        checkedAll.value = false;
        // 删除成功后延迟刷新，确保服务端数据已更新
        setTimeout(async () => {
          await refetch();
          await fetchStats();
        }, 300);
      } catch (e) {
        console.error("删除失败", e);
        Toast.error("删除失败");
      }
    },
  });
};

const handleOpenCreateModal = (footprint?: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};

const onEditingModalClose = async () => {
  selectedFootprint.value = undefined;
  await refetch();
  await fetchStats();
};

const handleTypeSelect = (type: string | undefined) => {
  selectedFootprintType.value = type;
  refetch();
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});

const handleUpdateLocation = (row: Footprint) => {
  showManualInput.value = true;
  currentFootprint.value = row;
};

const handleManualInput = async () => {
  if (!currentFootprint.value) return;
  
  const lng = parseFloat(manualLongitude.value);
  const lat = parseFloat(manualLatitude.value);
  
  if (isNaN(lng) || isNaN(lat)) {
    Toast.error("请输入有效的经纬度");
    return;
  }
  
  if (lng < -180 || lng > 180) {
    Toast.error("经度范围应在-180到180之间");
    return;
  }
  
  if (lat < -90 || lat > 90) {
    Toast.error("纬度范围应在-90到90之间");
    return;
  }
  
  try {
    currentFootprint.value.spec.longitude = lng;
    currentFootprint.value.spec.latitude = lat;
    
    await footprintApiClient.footprint.updateFootprint(
      currentFootprint.value.metadata.name,
      currentFootprint.value
    );
    
    Toast.success("经纬度更新成功");
    showManualInput.value = false;
    refetch();
  } catch (error) {
    console.error("更新经纬度失败:", error);
    Toast.error("更新经纬度失败");
  }
};

const handleRefreshAll = async () => {
  await refetch();
  await fetchStats();
};

const handleEdit = (footprint: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};

const awaitingGeocode = ref<string | null>(null);

const handleGeocodeFootprint = async (footprint: Footprint) => {
  try {
    awaitingGeocode.value = footprint.metadata.name;
    await footprintApiClient.footprint.geocodeFootprint(footprint.metadata.name);
    Toast.success("逆地理编码成功，省/市信息已更新");
    await refetch();
      await fetchStats();
    } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = null;
  }
};

</script>

<template>
  <div>
    <VPageHeader title="足迹管理">
      <template #actions>
        <VButton type="secondary" @click="editingModal = true">
          <template #icon>
            <IconAddCircle />
          </template>
          新建足迹
        </VButton>
      </template>
    </VPageHeader>

    <!-- 统计概览卡片 -->
    <div v-if="stats" class="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
      <VCard
        class="cursor-pointer hover:shadow-md transition-shadow"
        @click="showStatsDetail = !showStatsDetail"
      >
        <div class="p-4 text-center">
          <div class="text-3xl font-bold text-indigo-600">{{ stats.totalFootprints }}</div>
          <div class="text-sm text-gray-500 mt-1">总足迹数</div>
        </div>
      </VCard>
      <VCard
        class="cursor-pointer hover:shadow-md transition-shadow"
        @click="showStatsDetail = !showStatsDetail"
      >
        <div class="p-4 text-center">
          <div class="text-3xl font-bold text-indigo-600">{{ stats.totalProvinces }}</div>
          <div class="text-sm text-gray-500 mt-1">去过省级行政区</div>
        </div>
      </VCard>
      <VCard
        class="cursor-pointer hover:shadow-md transition-shadow"
        @click="showStatsDetail = !showStatsDetail"
      >
        <div class="p-4 text-center">
          <div class="text-3xl font-bold text-indigo-600">{{ stats.totalCities }}</div>
          <div class="text-sm text-gray-500 mt-1">去过城市</div>
        </div>
      </VCard>
    </div>

    <!-- 统计详情 -->
    <Transition name="fade">
      <div v-if="showStatsDetail && stats" class="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VCard title="省份详情">
          <div class="p-2 max-h-64 overflow-y-auto">
            <div
              v-for="province in stats.provinces"
              :key="province.adcode"
              class="flex items-center justify-between py-2 px-3 border-b last:border-none hover:bg-gray-50"
            >
              <div>
                <span class="font-medium">{{ province.name }}</span>
                <span v-if="province.cities && province.cities.length > 0" class="text-xs text-gray-400 ml-2">
                  {{ province.cities.slice(0, 5).join('、') }}<template v-if="province.cities.length > 5">等</template>
                </span>
              </div>
              <span class="text-sm text-indigo-600 font-medium">{{ province.count }} 条</span>
            </div>
            <VEmpty v-if="!stats.provinces || stats.provinces.length === 0" message="暂无省份数据" />
          </div>
        </VCard>
        <VCard title="城市详情">
          <div class="p-2 max-h-64 overflow-y-auto">
            <div
              v-for="city in stats.cities"
              :key="city.adcode"
              class="flex items-center justify-between py-2 px-3 border-b last:border-none hover:bg-gray-50"
            >
              <div>
                <span class="font-medium">{{ city.name }}</span>
                <span class="text-xs text-gray-400 ml-2">{{ city.province }}</span>
              </div>
              <span class="text-sm text-indigo-600 font-medium">{{ city.count }} 条</span>
            </div>
            <VEmpty v-if="!stats.cities || stats.cities.length === 0" message="暂无城市数据" />
          </div>
        </VCard>
      </div>
    </Transition>

    <div class="m-0 md:m-4">
      <VCard>
        <div class="flex justify-between bg-white py-4 px-4">
          <div class="flex flex-row items-center gap-3">
            <!-- 排序 -->
            <div class="flex flex-row items-center gap-1 text-sm text-gray-500">
              <FilterDropdown
                v-model="selectedSort"
                :items="[
                  { label: '创建时间升序', value: 'spec.createTime,asc' },
                  { label: '创建时间降序', value: 'spec.createTime,desc' },
                ]"
                label="排序"
              />
            </div>

            <!-- 类型 -->
            <div class="flex flex-row items-center gap-1 text-sm text-gray-500">
              <FilterDropdown
                v-model="selectedFootprintType"
                :items="[...footprintTypes.map(t => ({ label: t.label, value: t.value }))]"
                label="类型"
              />
            </div>

            <!-- 搜索输入框，回车搜索 -->
            <div class="flex items-center gap-1">
              <input
                v-model="searchText"
                type="text"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="搜索足迹名称"
                @keyup.enter="onKeywordChange"
              />
              <VButton type="secondary" size="sm" @click="handleReset">
                清空搜索
              </VButton>
            </div>

            <!-- 清空所有过滤条件 -->
            <FilterCleanButton v-if="hasFilters" @click="handleClearFilters" />
          </div>

          <div class="flex flex-row items-center gap-3">
            <!-- 批量删除按钮 -->
            <VSpace>
              <VButton
                v-if="selectedFootprints.length"
                type="danger"
                @click="handleDeleteInBatch"
              >
                删除选中
              </VButton>
            </VSpace>
            <div
              class="cursor-pointer rounded p-1 text-gray-600 transition-all hover:text-gray-900"
              :class="{ 'rolling': isFetching }"
              @click="handleRefreshAll()"
            >
              <IconRefreshLine />
            </div>
          </div>
        </div>

        <div class="table-container relative min-h-[200px]">
          <Transition name="fade" mode="out-in">
            <VLoading v-if="isLoading" />
            <VEmpty v-else-if="!footprints?.length" message="暂无足迹数据" />
            <table v-else class="widefat min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3 w-10">
                <input
                  v-model="checkedAll"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  type="checkbox"
                  @change="handleCheckAllChange"
                />
              </th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹名称 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹图片 </div></th>
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
              <td class="px-4 py-4 table-td">{{footprint.spec.province || '-'}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.city || '-'}}</td>
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
                        重新解析省/市
                      </VDropdownItem>
                    </div>
                  </template>
                </VDropdown>
              </td>
            </tr>
            </tbody>
          </table>
          </Transition>
        </div>

        <template #footer>
          <VPagination
            v-model:page="page"
            v-model:size="size"
            :total="total"
            :size-options="[20, 30, 50, 100]"
          />
        </template>
      </VCard>
    </div>
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

  <FootprintEditingModal
    v-model:visible="editingModal"
    :footprint="selectedFootprint"
    @close="onEditingModalClose"
  >
  </FootprintEditingModal>
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
