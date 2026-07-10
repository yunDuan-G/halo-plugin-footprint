package cc.lik.footprint.service;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.StatsResult;
import reactor.core.publisher.Mono;

public interface FootprintService {
    /**
     * 根据分组名称获取导航配置
     */
    Mono<BaseConfig> getConfigByGroupName();

    Mono<String> AddressLocationUtil(String address, String gaoDeWebKey);

    /**
     * 逆地理编码：根据经纬度获取省/市/adcode信息
     */
    Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String gaoDeWebKey);

    /**
     * 获取足迹统计（按省份/城市分组）
     */
    Mono<StatsResult> getStats();
}
