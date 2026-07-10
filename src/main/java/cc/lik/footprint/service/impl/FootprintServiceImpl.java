package cc.lik.footprint.service.impl;

import cc.lik.footprint.dto.BaseConfig;
import cc.lik.footprint.dto.GeoInfo;
import cc.lik.footprint.dto.StatsResult;
import cc.lik.footprint.model.Footprint;
import cc.lik.footprint.service.FootprintService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.plugin.ReactiveSettingFetcher;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import java.util.stream.Collectors;

@Component
@EnableScheduling
@AllArgsConstructor
@Slf4j
public class FootprintServiceImpl implements FootprintService {
    private final ReactiveSettingFetcher settingFetcher;
    private final ReactiveExtensionClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String GAODE_URL = "https://restapi.amap.com/v3/geocode/geo";
    private static final String GAODE_REGEO_URL = "https://restapi.amap.com/v3/geocode/regeo";

    @Override
    public Mono<BaseConfig> getConfigByGroupName() {
        return settingFetcher.get("base")
            .switchIfEmpty(Mono.error(new RuntimeException("配置不存在")))
            .flatMap(item -> {
                BaseConfig config = new BaseConfig(
                    item.path("title").asText("Handsome足迹"),
                    item.path("gaoDeKey").asText(),
                    item.path("gaoDeWebKey").asText(),
                    item.path("describe").asText("每一处足迹都充满了故事，那是对人生的思考和无限的风光。"),
                    item.path("hsla").asText("109,42%,60%"),
                    item.path("logoName").asText(),
                    item.path("mapStyle").asText()
                );
                return Mono.just(config);
            });
    }

    @Override
    public Mono<String> AddressLocationUtil(String address, String gaoDeWebKey) {
        return WebClient.create()
                .get()
                .uri(GAODE_URL, uriBuilder -> uriBuilder
                        .queryParam("key", gaoDeWebKey)
                        .queryParam("address", address)
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .mapNotNull(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if ("1".equals(jsonResponse.get("status").asText())) {
                            JsonNode geocodes = jsonResponse.get("geocodes");
                            if (geocodes.isArray() && !geocodes.isEmpty()) {
                                String location = geocodes.get(0).get("location").asText();
                                String[] coordinates = location.split(",");
                                return coordinates[0] + "," + coordinates[1];
                            }
                        }
                        log.warn("高德地图API返回错误: {}", jsonResponse.get("info").asText());
                        throw new RuntimeException("高德地图API返回错误: " + jsonResponse.get("info").asText());
                    } catch (Exception e) {
                        log.error("解析高德地图响应失败: {}", e.getMessage());
                        throw new RuntimeException("解析高德地图响应失败: " + e.getMessage());
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用高德地图API失败: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    @Override
    public Mono<GeoInfo> reverseGeocode(Double longitude, Double latitude, String gaoDeWebKey) {
        String location = longitude + "," + latitude;
        return WebClient.create()
                .get()
                .uri(GAODE_REGEO_URL, uriBuilder -> uriBuilder
                        .queryParam("key", gaoDeWebKey)
                        .queryParam("location", location)
                        .queryParam("extensions", "base")
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .map(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if ("1".equals(jsonResponse.get("status").asText())) {
                            JsonNode regeocode = jsonResponse.get("regeocode");
                            if (regeocode != null) {
                                JsonNode addressComponent = regeocode.get("addressComponent");
                                if (addressComponent != null) {
                                    String province = addressComponent.has("province") 
                                        ? addressComponent.get("province").asText() : "";
                                    // 直辖市city为空数组或空，使用province或district代替
                                    String city = "";
                                    if (addressComponent.has("city") && !addressComponent.get("city").isArray() 
                                        && !addressComponent.get("city").asText().isEmpty()) {
                                        city = addressComponent.get("city").asText();
                                    } else if (addressComponent.has("district") && !addressComponent.get("district").asText().isEmpty()) {
                                        city = addressComponent.get("district").asText();
                                    }

                                    String adcode = addressComponent.has("adcode") 
                                        ? addressComponent.get("adcode").asText() : "";

                                    // 省级adcode: 取前2位 + 0000
                                    String provinceAdcode = "";
                                    if (!adcode.isEmpty() && adcode.length() >= 6) {
                                        provinceAdcode = adcode.substring(0, 2) + "0000";
                                    }

                                    // 城市adcode: 取前4位 + 00
                                    String cityAdcode = "";
                                    if (!adcode.isEmpty() && adcode.length() >= 6) {
                                        cityAdcode = adcode.substring(0, 4) + "00";
                                    }

                                    return GeoInfo.builder()
                                            .province(province)
                                            .city(city)
                                            .provinceAdcode(provinceAdcode)
                                            .cityAdcode(cityAdcode)
                                            .build();
                                }
                            }
                        }
                        log.warn("逆地理编码返回错误: {}", jsonResponse.get("info").asText());
                        return GeoInfo.builder().build();
                    } catch (Exception e) {
                        log.error("解析逆地理编码响应失败: {}", e.getMessage());
                        return GeoInfo.builder().build();
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用逆地理编码API失败: {}", e.getMessage());
                    return Mono.just(GeoInfo.builder().build());
                });
    }

    @Override
    public Mono<StatsResult> getStats() {
        return client.list(Footprint.class, null, null)
                .filter(f -> f.getSpec() != null 
                    && f.getSpec().getProvinceAdcode() != null 
                    && !f.getSpec().getProvinceAdcode().isEmpty())
                .collectList()
                .map(footprints -> {
                    long totalFootprints = footprints.size();

                    // 按省份分组统计
                    Map<String, StatsResult.ProvinceStat> provinceMap = new LinkedHashMap<>();
                    for (Footprint f : footprints) {
                        String provinceAdcode = f.getSpec().getProvinceAdcode();
                        String provinceName = f.getSpec().getProvince();
                        if (provinceAdcode == null || provinceAdcode.isEmpty()) continue;

                        provinceMap.compute(provinceAdcode, (key, existing) -> {
                            if (existing == null) {
                                return StatsResult.ProvinceStat.builder()
                                        .name(provinceName != null ? provinceName : "")
                                        .adcode(provinceAdcode)
                                        .count(1)
                                        .cities(new ArrayList<>())
                                        .build();
                            } else {
                                existing.setCount(existing.getCount() + 1);
                                return existing;
                            }
                        });
                    }

                    // 按城市分组统计
                    Map<String, StatsResult.CityStat> cityMap = new LinkedHashMap<>();
                    for (Footprint f : footprints) {
                        String cityAdcode = f.getSpec().getCityAdcode();
                        String cityName = f.getSpec().getCity();
                        String provinceName = f.getSpec().getProvince();
                        if (cityAdcode == null || cityAdcode.isEmpty()) continue;

                        cityMap.compute(cityAdcode, (key, existing) -> {
                            if (existing == null) {
                                return StatsResult.CityStat.builder()
                                        .name(cityName != null ? cityName : "")
                                        .adcode(cityAdcode)
                                        .province(provinceName != null ? provinceName : "")
                                        .count(1)
                                        .build();
                            } else {
                                existing.setCount(existing.getCount() + 1);
                                return existing;
                            }
                        });
                    }

                    // 将城市关联到省份
                    for (StatsResult.CityStat city : cityMap.values()) {
                        String cityPrefix = city.getAdcode();
                        if (cityPrefix.length() >= 4) {
                            String provinceAdcode = cityPrefix.substring(0, 2) + "0000";
                            StatsResult.ProvinceStat province = provinceMap.get(provinceAdcode);
                            if (province != null) {
                                province.getCities().add(city);
                            }
                        }
                    }

                    List<StatsResult.ProvinceStat> provinces = new ArrayList<>(provinceMap.values());
                    provinces.sort(Comparator.comparing(StatsResult.ProvinceStat::getCount).reversed());

                    List<StatsResult.CityStat> cities = new ArrayList<>(cityMap.values());
                    cities.sort(Comparator.comparing(StatsResult.CityStat::getCount).reversed());

                    return StatsResult.builder()
                            .totalFootprints(totalFootprints)
                            .totalProvinces(provinceMap.size())
                            .totalCities(cityMap.size())
                            .provinces(provinces)
                            .cities(cities)
                            .build();
                });
    }
}
