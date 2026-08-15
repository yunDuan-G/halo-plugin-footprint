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
import run.halo.app.plugin.ReactiveSettingFetcher;
import run.halo.app.extension.ReactiveExtensionClient;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.*;
import java.util.stream.Collectors;

@Component
@EnableScheduling
@AllArgsConstructor
@Slf4j
public class FootprintServiceImpl implements FootprintService {
    private final ReactiveSettingFetcher settingFetcher;
    private final ReactiveExtensionClient client;
    private final ObjectMapper objectMapper = new ObjectMapper();

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
                    item.path("mapStyle").asText(),
                    item.path("markerStyle").asText("pin"),
                    item.path("enableHoverZoom").asBoolean(true),
                    item.path("highlightScheme").asText("glow"),
                    item.path("highlightVisitedCities").asBoolean(true),
                    item.path("photoWallPageSize").asInt(6)
                );
                return Mono.just(config);
            });
    }

    private static final String GAODE_URL = "https://restapi.amap.com/v3/geocode/geo";
    private static final String GAODE_REGEO_URL = "https://restapi.amap.com/v3/geocode/regeo";

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
                .mapNotNull(response -> {
                    try {
                        JsonNode jsonResponse = objectMapper.readTree(response);
                        if (!"1".equals(jsonResponse.get("status").asText())) {
                            log.warn("逆地理编码失败: {}", jsonResponse.get("info").asText());
                            return null;
                        }
                        JsonNode regeocode = jsonResponse.get("regeocode");
                        if (regeocode == null) {
                            return null;
                        }
                        JsonNode addressComponent = regeocode.get("addressComponent");
                        if (addressComponent == null) {
                            return null;
                        }

                        GeoInfo geoInfo = new GeoInfo();

                        String province = addressComponent.get("province").asText();
                        // 直辖市时 province 可能为空字符串
                        if (province == null || province.isEmpty()) {
                            province = addressComponent.path("city").asText();
                        }
                        geoInfo.setProvince(province);

                        // 城市：取 city，如果为空则取 district（直辖市情况）
                        String city = addressComponent.get("city").asText();
                        if (city == null || city.isEmpty()) {
                            city = addressComponent.path("district").asText();
                        }
                        geoInfo.setCity(city);

                        // adcode：区级编码（如440305），需推导省/市级编码
                        String adcode = addressComponent.path("adcode").asText();
                        if (adcode != null && !adcode.isEmpty()) {
                            // 省级编码：前2位 + "0000"（如440000=广东省）
                            if (adcode.length() >= 2) {
                                geoInfo.setProvinceAdcode(adcode.substring(0, 2) + "0000");
                            }
                            // 市级编码：前4位 + "00"（如440300=深圳市，而非440305=南山区）
                            if (adcode.length() >= 4) {
                                geoInfo.setCityAdcode(adcode.substring(0, 4) + "00");
                            } else {
                                geoInfo.setCityAdcode(adcode);
                            }
                        }

                        return geoInfo;
                    } catch (Exception e) {
                        log.error("解析逆地理编码响应失败: {}", e.getMessage());
                        return null;
                    }
                })
                .onErrorResume(e -> {
                    log.error("调用高德逆地理编码API失败: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    @Override
    public Mono<StatsResult> getStats() {
        return client.list(Footprint.class, fp -> true, null)
                .collectList()
                .map(footprints -> {
                    long totalFootprints = footprints.size();

                    // provinceAdcode -> {name, count, cityNames}
                    Map<String, StatsResult.ProvinceStat> provinceMap = new LinkedHashMap<>();
                    // cityAdcode -> {name, province, count}
                    Map<String, StatsResult.CityStat> cityMap = new LinkedHashMap<>();

                    for (Footprint fp : footprints) {
                        Footprint.FootprintSpec spec = fp.getSpec();
                        if (spec == null) continue;

                        // 省份统计
                        String pAdcode = spec.getProvinceAdcode();
                        String pName = spec.getProvince();
                        if (pAdcode != null && !pAdcode.isEmpty()) {
                            StatsResult.ProvinceStat ps = provinceMap.computeIfAbsent(pAdcode, k ->
                                StatsResult.ProvinceStat.builder()
                                    .adcode(k)
                                    .name(pName != null ? pName : "")
                                    .count(0)
                                    .cities(new ArrayList<>())
                                    .build());
                            ps.setCount(ps.getCount() + 1);
                        }

                        // 城市统计：将cityAdcode归一化为市级编码（前4位+00），兼容旧数据
                        String rawCAdcode = spec.getCityAdcode();
                        String cAdcode = rawCAdcode;
                        if (rawCAdcode != null && rawCAdcode.length() >= 4) {
                            cAdcode = rawCAdcode.substring(0, 4) + "00";
                        }
                        String cName = spec.getCity();
                        if (cAdcode != null && !cAdcode.isEmpty()) {
                            StatsResult.CityStat cs = cityMap.computeIfAbsent(cAdcode, k ->
                                StatsResult.CityStat.builder()
                                    .adcode(k)
                                    .name(cName != null ? cName : "")
                                    .province(pName != null ? pName : "")
                                    .provinceAdcode(pAdcode != null ? pAdcode : "")
                                    .count(0)
                                    .build());
                            cs.setCount(cs.getCount() + 1);
                        }

                        // 将城市名加入对应省份的城市列表
                        if (pAdcode != null && !pAdcode.isEmpty()
                            && cName != null && !cName.isEmpty()
                            && provinceMap.containsKey(pAdcode)) {
                            List<String> cities = provinceMap.get(pAdcode).getCities();
                            if (!cities.contains(cName)) {
                                cities.add(cName);
                            }
                        }
                    }

                                        List<StatsResult.ProvinceStat> sortedProvinces = new ArrayList<>(provinceMap.values());
                    sortedProvinces.sort((a, b) -> Long.compare(b.getCount(), a.getCount()));
                    List<StatsResult.CityStat> sortedCities = new ArrayList<>(cityMap.values());
                    sortedCities.sort((a, b) -> Long.compare(b.getCount(), a.getCount()));

                    return StatsResult.builder()
                            .totalFootprints(totalFootprints)
                            .totalProvinces(provinceMap.size())
                            .totalCities(cityMap.size())
                            .provinces(sortedProvinces)
                            .cities(sortedCities)
                            .build();
                });
    }
}
