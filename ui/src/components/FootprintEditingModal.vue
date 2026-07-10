<script lang="ts" setup>
import {Toast, VButton, VModal, VSpace} from "@halo-dev/components";
import {ref, computed, watch, onMounted} from "vue";
import {footprintApiClient} from "@/api";
import type {Footprint, Option} from "@/api/models";
import {toDatetimeLocal, toISOString} from "@/utils/date";
import {FormKit} from "@formkit/vue";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {Teleport} from "vue";


const props = withDefaults(
  defineProps<{
    visible: boolean;
    footprint?: Footprint;
  }>(),
  {
    visible: false,
    footprint: undefined,
  },
);

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "close"): void;
}>();

const articleType = ref<'post' | 'custom'>('post');

const initialFormState: Footprint = {
  metadata: {
    name: "",
    generateName: "footprint-",
  },
  spec: {
    name: "",
    description: "",
    longitude: 0,
    latitude: 0,
    address: "",
    province: "",
    city: "",
    provinceAdcode: "",
    cityAdcode: "",
    footprintType: "旅游",
    image: "",
    article: "",
    zoomLevel: "14",
    pitchAngle: "0",
    rotationAngle: "0",
    createTime: new Date().toISOString(),
  },
  kind: "Footprint",
  apiVersion: "footprint.lik.cc/v1alpha1",
};

// 使用JSON.parse(JSON.stringify())进行深拷贝，替代lodash.clonedeep
const deepClone = <T, >(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

const formState = ref<Footprint>(deepClone(initialFormState));
const saving = ref<boolean>(false);
const formVisible = ref(false);
const createTime = ref<string | undefined>(undefined);
const showManualInput = ref(false);
const manualLongitude = ref<string>("");
const manualLatitude = ref<string>("");
const geocoding = ref(false);

const isUpdateMode = computed(() => {
  return !!formState.value.metadata.creationTimestamp;
});

const modalTitle = computed(() => {
  return isUpdateMode.value ? "编辑足迹" : "新建足迹";
});

const onVisibleChange = (visible: boolean) => {
  emit("update:visible", visible);
  if (!visible) {
    emit("close");
  }
};

const handleResetForm = () => {
  formState.value = deepClone(initialFormState);
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      formVisible.value = true;
    } else {
      setTimeout(() => {
        formVisible.value = false;
        handleResetForm();
      }, 200);
    }
  },
);

watch(
  () => props.footprint,
  (footprint) => {
    if (footprint) {
      formState.value = deepClone(footprint);
      createTime.value = toDatetimeLocal(formState.value.spec.createTime);
    } else {
      createTime.value = undefined;
    }
  },
);

// 添加一个计算属性来控制pitchAngle的显示
const showPitchAngle = computed(() => {
  const zoomLevel = parseFloat(formState.value.spec.zoomLevel || '0')
  return zoomLevel >= 18
})

const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`,
} as const;

// 修改表单验证状态
const isFormValid = computed(() => {
  // 检查必填项
  if (!formState.value.spec.name?.trim()) return false;
  if (!formState.value.spec.description?.trim()) return false;
  if (!formState.value.spec.zoomLevel?.trim()) return false;
  if (!formState.value.spec.pitchAngle?.trim()) {
    formState.value.spec.pitchAngle = "0";
  }
  if (!formState.value.spec.rotationAngle?.trim()) {
    formState.value.spec.rotationAngle = "0";
  }
  return formState.value.spec.address?.trim();
});

// 逆地理编码填充省/市信息
const handleGeocode = async () => {
  const lng = formState.value.spec.longitude;
  const lat = formState.value.spec.latitude;
  if (!lng || !lat) {
    Toast.error("请先填写经纬度");
    return;
  }

  geocoding.value = true;
  try {
    // 先在编辑模式下保存后再geocode，新建模式直接尝试
    Toast.info("正在解析省/市信息...");
    // 可以通过后端API直接解析
    const response = await footprintApiClient.footprint.geocodeFootprint(
      formState.value.metadata.name || "temp"
    );
    formState.value.spec.province = response.spec.province;
    formState.value.spec.city = response.spec.city;
    formState.value.spec.provinceAdcode = response.spec.provinceAdcode;
    formState.value.spec.cityAdcode = response.spec.cityAdcode;
    Toast.success("省/市信息解析成功");
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("解析失败，请手动填写");
  } finally {
    geocoding.value = false;
  }
};

const handleSubmit = async () => {
  try {
    // 先进行表单验证
    if (!isFormValid.value) {
      // 检查具体错误并显示提示
      if (!formState.value.spec.name?.trim()) {
        Toast.error("足迹名称不能为空");
        return;
      }
      if (!formState.value.spec.description?.trim()) {
        Toast.error("足迹描述不能为空");
        return;
      }
      if (!formState.value.spec.address?.trim()) {
        Toast.error("地址不能为空");
        return;
      }
      if (!formState.value.spec.zoomLevel?.trim()) {
        Toast.error("缩放级别不能为空");
        return;
      }
      if (!formState.value.spec.pitchAngle?.trim()) {
        Toast.error("俯仰角度不能为空");
        return;
      }
      if (!formState.value.spec.rotationAngle?.trim()) {
        Toast.error("旋转角度不能为空");
        return;
      }
      if (!createTime.value) {
        Toast.error("请选择创建时间");
        return;
      }

      Toast.error("请检查表单填写是否正确");
      return;
    }

    const zoomLevel = formState.value.spec.zoomLevel;
    if (parseFloat(zoomLevel) < 4 || parseFloat(zoomLevel) > 26) {
      Toast.error("缩放级别必须在4到26之间");
      return;
    }

    const pitchAngle = formState.value.spec.pitchAngle
    if (parseFloat(pitchAngle) < 0 || parseFloat(pitchAngle) > 83) {
      Toast.error("俯仰角度必须在0到83之间");
      return;
    }

    const rotationAngle = formState.value.spec.rotationAngle
    if (parseFloat(rotationAngle) < -360 || parseFloat(rotationAngle) > 360) {
      Toast.error("旋转角度必须在-360到360之间");
      return;
    }

    saving.value = true;

    if (createTime.value) {
      formState.value.spec.createTime = toISOString(createTime.value);
    }

    if (!isUpdateMode.value) {
      await footprintApiClient.footprint.createFootprint(formState.value);
      Toast.success("创建成功");
    } else {
      await footprintApiClient.footprint.updateFootprint(formState.value.metadata.name, formState.value);
      Toast.success("更新成功");
    }

    onVisibleChange(false);
  } catch (error) {
    console.error("保存失败:", error);
    Toast.error("保存失败");
  } finally {
    saving.value = false;
  }
};

const handleUpdateLocation = () => {
  showManualInput.value = true;
};

// 确认手动更新经纬度
const handleConfirmManualInput = () => {
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

  formState.value.spec.longitude = lng;
  formState.value.spec.latitude = lat;
  showManualInput.value = false;
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});
</script>

<template>
  <VModal
    :visible="props.visible"
    :width="600"
    :title="modalTitle"
    :mask-closable="false"
    @update:visible="onVisibleChange"
  >
    <FormKit
      v-if="formVisible"
      id="footprint-form"
      v-model="formState"
      type="form"
      name="footprint-form"
      :config="{ validationVisibility: 'submit' }"
      :actions="false"
      @submit="handleSubmit"
    >
      <div class="divide-y divide-gray-200 px-4 py-4 sm:px-6">
        <div class="space-y-4">
          <FormKit
            v-model="formState.spec.name"
            type="text"
            name="name"
            label="足迹名称"
            validation="required|length:0,100"
            :validation-messages="validationMessages"
            placeholder="请输入足迹名称"
            help="足迹名称，最多100个字符"
          ></FormKit>

          <FormKit
            v-model="formState.spec.description"
            type="textarea"
            name="description"
            label="足迹描述"
            validation="required|length:0,500"
            :validation-messages="validationMessages"
            placeholder="请输入足迹描述"
            help="足迹描述，最多500个字符"
            rows="3"
          ></FormKit>

          <FormKit
            v-model="formState.spec.address"
            type="textarea"
            name="address"
            label="地址"
            placeholder="输入地址后自动获取经纬度及省/市信息"
            :help="formState.spec.longitude ? `经纬度: ${formState.spec.longitude}, ${formState.spec.latitude}` : '经纬度将自动填充'"
            rows="2"
          ></FormKit>

          <!-- 新增：省/市显示字段 -->
          <div class="grid grid-cols-2 gap-4">
            <div class="formkit-wrapper">
              <label class="formkit-label">省份</label>
              <div class="flex items-center gap-2">
                <input
                  v-model="formState.spec.province"
                  type="text"
                  class="formkit-input"
                  placeholder="自动解析填充"
                  readonly
                />
              </div>
            </div>
            <div class="formkit-wrapper">
              <label class="formkit-label">城市</label>
              <div class="flex items-center gap-2">
                <input
                  v-model="formState.spec.city"
                  type="text"
                  class="formkit-input"
                  placeholder="自动解析填充"
                  readonly
                />
              </div>
            </div>
          </div>

          <FormKit
            v-model="formState.spec.footprintType"
            :options="footprintTypes"
            label="足迹类型"
            name="footprintType"
            type="select"
          ></FormKit>

          <FormKit
            v-model="formState.spec.image"
            :type="'attachment' as any"
            name="image"
            label="足迹图片"
          ></FormKit>

          <FormKit
            v-model="articleType"
            type="select"
            name="articleType"
            label="关联类型"
            :options="[
              { label: '文章', value: 'post' },
              { label: '自定义链接', value: 'custom' },
            ]"
          ></FormKit>

          <template v-if="articleType === 'post'">
            <FormKit
              v-model="formState.spec.article"
              type="select"
              name="article"
              label="关联文章"
              :multiple="false"
              clearable
              searchable
              action="/apis/content.halo.run/v1alpha1/posts"
              :request-option="{
                method: 'GET',
                pageField: 'page',
                sizeField: 'size',
                totalField: 'total',
                itemsField: 'items',
                labelField: 'spec.title',
                valueField: 'status.permalink',
              }"
            ></FormKit>
          </template>

          <template v-else-if="articleType === 'custom'">
            <FormKit
              v-model="formState.spec.article"
              type="text"
              name="customArticle"
              label="链接地址"
              placeholder="请输入完整的URL，例如https://example.com"
              validation="url"
              :validation-messages="{
                url: '请输入有效的URL地址，需包含http://或https://',
              }"
            ></FormKit>
          </template>

          <FormKit
            v-model="formState.spec.metadataNames"
            type="select"
            name="metadataNames"
            label="关联足迹"
            :multiple="true"
            :debounce="300"
            :min-chars="1"
            clearable
            searchable
            action="/apis/api.footprint.lik.cc/v1alpha1/footprints"
            :request-option="{
              method: 'GET',
              pageField: 'page',
              sizeField: 'size',
              totalField: 'total',
              itemsField: 'items',
              labelField: 'spec.name',
              valueField: 'metadata.name',
            }"
          ></FormKit>

          <FormKit
            v-model="createTime"
            type="datetime-local"
            min="0000-01-01T00:00"
            max="9999-12-31T23:59"
            name="createTime"
            validation="required"
            label="创建时间"
            help="如果为空，则使用当前时间"
          ></FormKit>
        </div>
      </div>
    </FormKit>

    <template #footer>
      <VSpace>
        <VButton type="secondary" @click="onVisibleChange(false)">
          取消
        </VButton>
        <VButton
          type="primary"
          :loading="saving"
          :disabled="!isFormValid"
          @click="handleSubmit"
        >
          确定
        </VButton>
      </VSpace>
    </template>
  </VModal>

  <!-- 手动输入经纬度的对话框 -->
  <Teleport to="body">
    <VModal
      v-model:visible="showManualInput"
      :width="460"
      title="手动更新经纬度"
      :mask-closable="false"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">经度</label>
          <input
            v-model="manualLongitude"
            type="number"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入经度（-180到180）"
            step="0.000001"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">纬度</label>
          <input
            v-model="manualLatitude"
            type="number"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入纬度（-90到90）"
            step="0.000001"
          />
        </div>
      </div>
      <template #footer>
        <VSpace>
          <VButton type="secondary" @click="showManualInput = false">
            取消
          </VButton>
          <VButton type="primary" @click="handleConfirmManualInput">
            确定
          </VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>
</template>

<style scoped lang="scss">
.divide-y td {
  margin-bottom: 9px;
  line-height: 1.3;
  padding-bottom: 1rem;
}

.divide-y td p {
  margin-bottom: 6px;
}

.formkit-wrapper {
  margin-bottom: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.formkit-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 0.25rem;
}

.formkit-input {
  display: block;
  width: 100%;
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: #111827;
  background-color: #fff;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.formkit-input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}
</style>
