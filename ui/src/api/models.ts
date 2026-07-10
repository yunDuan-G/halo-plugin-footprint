/**
 * 元数据接口
 */
export interface Metadata {
  name: string;
  generateName?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  version?: number;
}

/**
 * 足迹规格接口
 */
export interface FootprintSpec {
  /**
   * 足迹名称
   */
  name: string;

  /**
   * 足迹描述
   */
  description?: string;

  /**
   * 经度
   */
  longitude: number;

  /**
   * 纬度
   */
  latitude: number;

  /**
   * 地址
   */
  address?: string;

  /**
   * 省级行政区名称（省/直辖市/自治区/特别行政区）
   */
  province?: string;

  /**
   * 城市名称
   */
  city?: string;

  /**
   * 省级行政区编码
   */
  provinceAdcode?: string;

  /**
   * 城市编码
   */
  cityAdcode?: string;

  /**
   * 足迹类型
   */
  footprintType?: string;

  /**
   * 足迹图片
   */
  image?: string;

  /**
   * 关联文章URL
   */
  article?: string;

  /**
   * 关联足迹
   */
  metadataNames?: [];

  /**
   * 缩放级别 4-26
   */
  zoomLevel: string;

  /**
   * 俯仰角度 0-83
   * 3D地图启用 
   */
  pitchAngle: string;

  /**
   * 旋转角度  -360到360
   * 3D地图启用
   */
  rotationAngle: string;

  /**
   * 创建时间
   */
  createTime?: string;
}

/**
 * 足迹状态接口
 */
export interface FootprintStatus {
  /**
   * 是否已发布
   */
  published?: boolean;

  /**
   * 发布时间
   */
  publishTime?: string;
}

/**
 * 足迹接口
 */
export interface Footprint {
  apiVersion: string;
  kind: string;
  metadata: Metadata;
  spec: FootprintSpec;
  status?: FootprintStatus;
}

/**
 * 足迹列表接口
 */
export interface FootprintList {
  page: number;
  size: number;
  total: number;
  items: Footprint[];
  first: boolean;
  last: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  totalPages: number;
}

/**
 * 选项
 **/
export interface Option {
  label: string;
  value: string;
}

/**
 * 城市统计
 */
export interface CityStat {
  name: string;
  adcode: string;
  province: string;
  count: number;
}

/**
 * 省份统计
 */
export interface ProvinceStat {
  name: string;
  adcode: string;
  count: number;
  cities: CityStat[];
}

/**
 * 统计结果
 */
export interface StatsResult {
  totalFootprints: number;
  totalProvinces: number;
  totalCities: number;
  provinces: ProvinceStat[];
  cities: CityStat[];
}

/**
 * 逆地理编码结果
 */
export interface GeoInfo {
  province: string;
  city: string;
  provinceAdcode: string;
  cityAdcode: string;
}
