    // ================= 配置 =================
    // 天地图 Key：在 https://lbs.tianditu.gov.cn 注册后申请（浏览器端应用）
    // 不填则自动降级：只显示高德底图，无天地图影像/注记，也无三维地形
    // 天地图 Key 由后台“3D 地球”设置注入，不再硬编码
    const TDT_KEY = (window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.tiandituKey) || '';
    const hasTDTKey = TDT_KEY && TDT_KEY !== 'YOUR_TIANDITU_KEY';

    const statusText = document.getElementById('statusText');
    const statusRetry = document.getElementById('statusRetry');

    // 初始加载反馈：标记页面忙碌，瓦片全部就绪后解除（20 秒兜底，防卡死）
    document.body.setAttribute('aria-busy', 'true');

    // 瓦片加载失败：自动重试（瞬时断连 ERR_CONNECTION_CLOSED 重试通常可恢复），
    // 重试耗尽后提示；提示规则：3 秒内连续 2 个瓦片失败才提示，避免单瓦片抖动误报。
    let tileErrorCount = 0;
    let tileErrorTimer = null;
    let tileErrorShown = false;
    const TILE_RETRY_MAX = 3;   // timesRetried 达到此值后停止自动重试
    function tileErrorHandler(err) {
        // 403 = Key 未授权当前域名（天地图域名白名单），重试无用，直接提示
        const httpStatus = err && err.error && err.error.statusCode;
        const msg403 = /status code:\s*403/i.test((err && err.message) || '');
        const msg429 = /status code:\s*429/i.test((err && err.message) || '');
        if (httpStatus === 403 || msg403) {
            if (!tileErrorShown) {
                tileErrorShown = true;
                statusText.textContent += '，底图 Key 未授权当前域名（403）';
                statusRetry.hidden = false;
            }
            return;
        }
        // 429 = 天地图请求超限（Key 配额或瞬时并发上限），立即重试只会加重限制
        if (httpStatus === 429 || msg429) {
            if (!tileErrorShown) {
                tileErrorShown = true;
                statusText.textContent += '，天地图请求超限（429）';
                statusRetry.hidden = false;
            }
            return;
        }
        // 瓦片失败触发的是 provider.errorEvent，事件对象是 TileProviderError；
        // 设置 retry=true 会让 Cesium 重新请求该瓦片（次数受限，防止无限循环）
        if (err && err.timesRetried >= 0 && err.timesRetried < TILE_RETRY_MAX) {
            err.retry = true;
            return;
        }
        tileErrorCount++;
        clearTimeout(tileErrorTimer);
        tileErrorTimer = setTimeout(() => { tileErrorCount = 0; }, 3000);
        if (!tileErrorShown && tileErrorCount >= 2) {
            tileErrorShown = true;
            statusText.textContent += '，瓦片加载失败';
            statusRetry.hidden = false;
        }
    }
    // provider 会被底图切换复用，同一 provider 只挂一次监听
    const tileErrorAttached = new Set();
    function attachTileError(provider) {
        if (provider && provider.errorEvent && !tileErrorAttached.has(provider)) {
            provider.errorEvent.addEventListener(tileErrorHandler);
            tileErrorAttached.add(provider);
        }
    }
    statusRetry.addEventListener('click', () => {
        statusRetry.hidden = true;
        if (currentBaseKey) switchBase(currentBaseKey);
    });

    const btnMap = Object.fromEntries(
        [...document.querySelectorAll('#layerButtons button')].map(b => [b.dataset.key, b])
    );

    // ================= 坐标转换（WGS84 <-> GCJ-02） =================
    // 高德瓦片基于 GCJ-02（火星坐标），天地图基于 CGCS2000（≈WGS84）。
    // 在 WGS84 地球上叠加高德瓦片时，标记必须转成 GCJ-02 才能对准地图内容。
    // 算法为公开的 eviltransform / coordtransform 同款；海外坐标不加密，原样返回。
    const GCJ_A = 6378245.0;
    const GCJ_EE = 0.00669342162296594323;

    function gcjOutOfChina(lng, lat) {
        return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
    }

    function gcjTransformLat(x, y) {
        let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }

    function gcjTransformLng(x, y) {
        let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }

    // WGS84 -> GCJ-02（高德底图下放置标记用）
    function wgs84ToGcj02(lng, lat) {
        if (gcjOutOfChina(lng, lat)) {
            return { lng, lat };
        }
        const dLat = gcjTransformLat(lng - 105.0, lat - 35.0);
        const dLng = gcjTransformLng(lng - 105.0, lat - 35.0);
        const radLat = (lat / 180.0) * Math.PI;
        let magic = Math.sin(radLat);
        magic = 1 - GCJ_EE * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        const mgLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
        const mgLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
        return { lng: lng + mgLng, lat: lat + mgLat };
    }

    // GCJ-02 -> WGS84（天地图底图下用；迭代逼近，误差亚米级）
    function gcj02ToWgs84(lng, lat) {
        if (gcjOutOfChina(lng, lat)) {
            return { lng, lat };
        }
        let lng2 = lng;
        let lat2 = lat;
        for (let i = 0; i < 3; i++) {
            const g = wgs84ToGcj02(lng2, lat2);
            lng2 = lng2 - (g.lng - lng);
            lat2 = lat2 - (g.lat - lat);
        }
        return { lng: lng2, lat: lat2 };
    }

    // ================= 高德底图（无需 Key） =================
    // 高德矢量路网图（含地名标注）
    const amapVec = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // 高德卫星影像
    const amapImg = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // 高德卫星影像上的中文标注（style=8，透明标注层，叠加在影像上）
    const amapImgLabel = new Cesium.UrlTemplateImageryProvider({
        url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
        subdomains: ['1', '2', '3', '4'],
        maximumLevel: 18
    });

    // ================= 天地图影像（需要 Key） =================
    // 天地图 _w（Web 墨卡托）瓦片：第 L 级为 2^L × 2^L 张（第 1 级即 2×2），
    // 行列号与 Cesium 默认 WebMercatorTilingScheme 直接对应，无需任何偏移。
    // 使用 DataServer REST 接口（dvgis/cesium-map 等成熟实现同款），
    // 避免 WMTS 接口因矩阵编号/几何不一致导致的瓦片错位。
    // 图层代码：vec/cva=矢量底图/注记，img/cia=影像底图/注记
    let tdtVec = null, tdtCva = null, tdtImg = null, tdtCia = null;
    if (hasTDTKey) {
        const tdtOptions = {
            subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
            maximumLevel: 18
        };
        tdtVec = new Cesium.UrlTemplateImageryProvider({
            ...tdtOptions,
            url: 'https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
        });
        tdtCva = new Cesium.UrlTemplateImageryProvider({
            ...tdtOptions,
            url: 'https://t{s}.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
        });
        tdtImg = new Cesium.UrlTemplateImageryProvider({
            ...tdtOptions,
            url: 'https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
        });
        tdtCia = new Cesium.UrlTemplateImageryProvider({
            ...tdtOptions,
            url: 'https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&x={x}&y={y}&l={z}&tk=' + TDT_KEY
        });

        // 有 Key 时启用天地图底图按钮
        btnMap.tdtImg.disabled = false;
        btnMap.tdtVec.disabled = false;
        btnMap.tdtImgClean.disabled = false;
        btnMap.tdtVecClean.disabled = false;
    }

    // ================= 初始化 Viewer =================
    const viewer = new Cesium.Viewer('cesiumContainer', {
        baseLayer: false,          // 不用 Cesium 默认底图，全部换成国内服务
        animation: false,          // 隐藏左下角动画控件
        timeline: false,           // 隐藏底部时间轴
        fullscreenButton: false,   // 隐藏右下角全屏按钮
        baseLayerPicker: false,    // 隐藏右上角底图选择器
        geocoder: false,           // 隐藏右上角搜索框
        homeButton: false,         // 隐藏右上角 Home 按钮
        sceneModePicker: false,    // 隐藏右上角 2D/3D 模式切换按钮
        navigationHelpButton: false, // 隐藏右上角导航帮助按钮
        infoBox: false,            // 隐藏点击实体后的信息框
        selectionIndicator: false, // 隐藏点击实体后的四角选中框
        useBrowserRecommendedResolution: false // 高分屏按设备像素渲染，文字更清晰
        // 已移除 Cesium.Terrain.fromWorldTerrain()（依赖海外 Ion 服务），地形改由天地图提供
    });

    viewer.cesiumWidget.creditContainer.style.display = 'none';

    // 降低 LOD 容差：让 Cesium 更早加载高一级瓦片，避免把低清瓦片拉伸导致地名发糊。
    // 默认是 2.0，改成 1.0 后瓦片请求量会明显增加，但文字更锐利。
    viewer.scene.maximumScreenSpaceError = 1.0;

    // ================= 相机交互（鼠标滚轮缩放） =================
    // zoomFactor 在 Cesium 1.121 才作为公开属性暴露（更新日志 #12099），
    // 1.120 中设置 zoomFactor 不会生效（滚轮逻辑读取的是私有字段 _zoomFactor）。
    // 这里做特性检测：新版本用公开属性，1.120 用私有字段回退。
    const cameraController = viewer.scene.screenSpaceCameraController;
    const WHEEL_ZOOM_FACTOR = 2.5;   // 滚轮灵敏度系数（默认 5，越小滚一格缩放越精细）
    if ('zoomFactor' in cameraController) {
        cameraController.zoomFactor = WHEEL_ZOOM_FACTOR;
    } else {
        cameraController._zoomFactor = WHEEL_ZOOM_FACTOR;
    }
    // 缩放距离范围（米）：防止放大穿入地形、拉远把地球滚丢
    cameraController.minimumZoomDistance = 50;
    cameraController.maximumZoomDistance = 50000000;

    // 瓦片全部加载完成后解除忙碌状态
    viewer.scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
        if (pending === 0) document.body.setAttribute('aria-busy', 'false');
    });
    setTimeout(() => document.body.setAttribute('aria-busy', 'false'), 20000);

    // 开启昼夜光照：按时钟时间计算太阳位置，夜半球变暗（2D 平面模式下不生效）
    viewer.scene.globe.enableLighting = true;
    // 让时间自动推进，明暗分界线随时间缓缓移动
    viewer.clock.shouldAnimate = true;

    // 3D 地球品牌文案：标题/描述使用“3D 地球”Tab 的独立配置（globeTitle/globeDesc），
    // 导航栏英文名保持默认 "Travel Memory"，不再从基本设置读取。
    const footprintCfg = window.FOOTPRINT_CONFIG || {};
    const navBrandZh = document.querySelector('.nav-brand-zh');
    const introTitleEl = document.querySelector('.intro-title');
    const introDescEl = document.querySelector('.intro-desc');
    if (navBrandZh && footprintCfg.globeTitle) navBrandZh.textContent = footprintCfg.globeTitle;
    if (introTitleEl && footprintCfg.globeTitle) introTitleEl.textContent = footprintCfg.globeTitle;
    if (introDescEl && footprintCfg.globeDesc) introDescEl.textContent = footprintCfg.globeDesc;

    // ================= 左侧标题卡（仅 3D，整球视图显示） =================
    const pageIntro = document.getElementById('pageIntro');
    const topNav = document.getElementById('topNav');   // 导航栏与标题卡同步显隐
    const backGlobeBtn = document.getElementById('backGlobeBtn');   // 放大后显示，一键回球
    const cityFillFloatBtn = document.getElementById('cityFillFloatBtn');   // 放大后显示，城市高亮开关
    // 相机高度（米）：高于 SHOW 时显示（能看到整个地球），低于 HIDE 时隐藏；
    // 中间区间保持原状态，避免在阈值附近来回闪烁。
    const INTRO_SHOW_HEIGHT = 9500000;
    const INTRO_HIDE_HEIGHT = 9500000;
    let introVisible = false;
    let amapMode = false;   // 当前是否处于 2D 高德地图视图（切换按钮逻辑与导航栏显隐共用）
    let entranceActive = false;   // 开场动画进行中（暂缓标题卡显示）

    // 中国边界线：仅在放大到国内范围时显示，首屏整球视图保持干净。
    // 低于 SHOW 高度显示，高于 HIDE 高度隐藏，中间区间保持原状态防闪烁。
    const BOUNDARY_SHOW_HEIGHT = 9500000;
    const BOUNDARY_HIDE_HEIGHT = 9500000;
    let chinaBoundarySource = null;
    let boundaryVisible = false;
    // 标记详情卡：整球视图（标题卡出现）时自动收起；初始化完成前不触发
    let markerCardReady = false;
    // 城市聚合状态（提前声明，updateIntroVisibility 会读取）
    let cityList = [];            // [{ city, indices: [足迹下标] }]，按数据顺序
    let cityMarkerEntities = [];  // 城市标记实体
    const CITY_EXPAND_HEIGHT = 1500000;    // 相机低于此高度时展开为单个足迹
    const CITY_COLLAPSE_HEIGHT = 1800000;  // 高于此高度时聚合为城市标记
    let cityMode = true;
    // 城市淡色填充（提前声明，updateIntroVisibility 会控制显隐）
    let cityFillDataSources = [];
    let cityFillBuildId = 0;
    let cityOutlinePolylines = [];   // 城市轮廓描边折线（悬停聚焦时统一调透明度）
    let focusedMarker = null;        // 当前聚焦（悬停/键盘选中）的标记，null 表示无
    const cityBoundaryCache = new Map();   // 城市边界数据缓存：同一会话内按 adcode 只请求一次
    // 城市填充主题：amber 琥珀橙 / gold 柔金 / mint 薄荷青 / ice 冰蓝
    const CITY_FILL_THEME = 'amber';
    const CITY_FILL_THEMES = {
        amber: { fill: 'rgba(255, 149, 66, 0.22)' },
        gold:  { fill: 'rgba(240, 198, 120, 0.25)' },
        mint:  { fill: 'rgba(88, 204, 180, 0.20)' },
        ice:   { fill: 'rgba(110, 160, 255, 0.18)' }
    };

    function updateIntroVisibility() {
        // 开场动画期间：标题卡暂缓显示，动画结束后由下一帧的相机高度逻辑自动显示
        if (entranceActive) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.add('visible');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 全屏覆盖层（城市足迹 / 相册）打开时隐藏顶部导航栏与标题卡，避免遮挡；
        // 这里用 getElementById 动态判断，避免引用后置声明的变量（TDZ）。
        const cityViewEl = document.getElementById('cityView');
        const albumOverlayEl = document.getElementById('albumOverlay');
        const ticketGalleryEl = document.getElementById('ticketGallery');
        const overlayOpen = !!(cityViewEl && cityViewEl.classList.contains('show')) ||
            !!(albumOverlayEl && albumOverlayEl.classList.contains('show')) ||
            !!(ticketGalleryEl && ticketGalleryEl.classList.contains('show'));
        if (overlayOpen) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.remove('visible');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 2D 高德视图：导航栏常驻（保证 2D/3D 切换按钮可用），地球标题卡/浮动按钮隐藏
        if (amapMode) {
            pageIntro.classList.remove('visible');
            topNav.classList.add('visible');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 2D / Columbus / 变形过程中标题一律隐藏；导航栏保留（否则 2D 下无法切回 3D）
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.add('visible');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
        } else {
            const h = viewer.camera.positionCartographic.height;
            if (!introVisible && h > INTRO_SHOW_HEIGHT) {
                introVisible = true;
                pageIntro.classList.add('visible');
                topNav.classList.add('visible');
                if (markerCardReady && markerCard.classList.contains('visible')) {
                    hideMarkerCard();   // 回到整球视图时自动关闭详情卡
                }
            } else if (introVisible && h < INTRO_HIDE_HEIGHT) {
                introVisible = false;
                pageIntro.classList.remove('visible');
                topNav.classList.remove('visible');
            }
            // 3D 下放大到看不到整球时，显示“回到整球”和“城市高亮”浮动按钮
            backGlobeBtn.classList.toggle('show', !introVisible);
            cityFillFloatBtn.classList.toggle('show', !introVisible);
        }

        // 中国边界：放大到国内范围才显示，拉远/整球视图隐藏
        if (chinaBoundarySource) {
            const h = viewer.camera.positionCartographic.height;
            if (!boundaryVisible && h < BOUNDARY_SHOW_HEIGHT) {
                boundaryVisible = true;
                chinaBoundarySource.show = true;
            } else if (boundaryVisible && h > BOUNDARY_HIDE_HEIGHT) {
                boundaryVisible = false;
                chinaBoundarySource.show = false;
            }
        }

        // 城市淡色填充：与边界同阈值显隐
        cityFillDataSources.forEach(ds => {
            ds.show = viewer.camera.positionCartographic.height < BOUNDARY_SHOW_HEIGHT;
        });

        // 城市聚合切换：放大到城市范围展开为单个足迹，拉远聚合回城市标记
        const modeH = viewer.camera.positionCartographic.height;
        if (cityMode && modeH < CITY_EXPAND_HEIGHT) {
            applyMarkerMode(false);
        } else if (!cityMode && modeH > CITY_COLLAPSE_HEIGHT) {
            applyMarkerMode(true);
        }
    }
    viewer.scene.postRender.addEventListener(updateIntroVisibility);
    updateIntroVisibility();

    // 回到整球视图：飞回初始中国朝向的整球视角
    backGlobeBtn.addEventListener('click', () => {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            duration: 1.8
        });
    });

    // ================= 2D/3D 自定义切换按钮 =================
    // 3D：Cesium 地球（默认首页）；2D：切换为项目原有高德地图（懒加载，见 footprint.js 的 window.Footprint2D）。
    // 切换过程使用 Cesium 原生 morph 动画：3D→2D 先让地球“展开”成平面，动画结束再显示高德页面；
    // 2D→3D 先显示仍处于平面状态的地球，再“合并”回球体。
    const sceneModeBtn = document.getElementById('sceneModeBtn');
    const view3d = document.getElementById('view-3d');
    const view2d = document.getElementById('view-2d');
    const MORPH_DURATION = 1.5;   // 展开/合并动画时长（秒）
    let morphing = false;         // morph 动画进行中，防止重复点击
    let pendingMode = null;       // 动画结束后的目标模式：'2d' | '3d'
    let morphTimeoutId = null;    // 兜底：morph 事件异常未触发时强制完成切换

    // 视图模式记忆：刷新后保持上次的 2D/3D 状态
    const VIEW_MODE_STORAGE_KEY = 'travelMemoryViewMode';
    function getSavedViewMode() {
        try { return localStorage.getItem(VIEW_MODE_STORAGE_KEY) || '3d'; } catch (e) { return '3d'; }
    }
    function saveViewMode(mode) {
        try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch (e) { /* 忽略 */ }
    }

    function armMorphTimeout() {
        clearTimeout(morphTimeoutId);
        morphTimeoutId = setTimeout(() => {
            if (!morphing) return;
            console.warn('morph 动画超时，强制执行视图切换');
            if (pendingMode === '2d') {
                finishSwitchTo2D();
            } else if (pendingMode === '3d') {
                finishSwitchTo3D();
            } else {
                morphing = false;
            }
        }, MORPH_DURATION * 1000 + 800);
    }

    // 中国大致范围（含南海诸岛），用于平面视角定位
    const CHINA_VIEW = Cesium.Rectangle.fromDegrees(73.5, 3.8, 135.1, 53.6);
    // 世界全图范围，作为 2D 动画起点（Web Mercator 纬度上限约 ±85.05°）
    const WORLD_VIEW = Cesium.Rectangle.fromDegrees(-180, -85.05, 180, 85.05);

    // 2D 下从“整个世界地图”平滑缩放到指定矩形（绕开 camera.flyTo 在 2D 模式的已知问题）
    function animateCameraToRect(targetRect, duration, onComplete) {
        const startPos = viewer.camera.getRectangleCameraCoordinates(WORLD_VIEW);
        const start = viewer.scene.mapProjection.unproject(startPos);
        const endPos = viewer.camera.getRectangleCameraCoordinates(targetRect);
        const end = viewer.scene.mapProjection.unproject(endPos);

        const startLng = Cesium.Math.toDegrees(start.longitude);
        const startLat = Cesium.Math.toDegrees(start.latitude);
        const startH = start.height;
        const endLng = Cesium.Math.toDegrees(end.longitude);
        const endLat = Cesium.Math.toDegrees(end.latitude);
        const endH = end.height;

        const startTime = performance.now();

        function tick(now) {
            const t = Math.min((now - startTime) / (duration * 1000), 1);
            const k = t * t * (3 - 2 * t); // smoothstep 缓动
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(
                    startLng + (endLng - startLng) * k,
                    startLat + (endLat - startLat) * k,
                    startH + (endH - startH) * k
                )
            });
            if (t < 1) {
                requestAnimationFrame(tick);
            } else if (onComplete) {
                onComplete();
            }
        }
        requestAnimationFrame(tick);
    }

    function updateSceneModeBtn() {
        sceneModeBtn.textContent = viewer.scene.mode === Cesium.SceneMode.SCENE2D ? '2D' : '3D';
    }

    // 切换前收起地球侧可能打开的覆盖层，避免返回 3D 时残留
    function closeGlobeOverlays() {
        ['markerCard', 'lightbox', 'albumOverlay', 'cityView', 'markerTip'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('visible');
                el.classList.remove('show');
            }
        });
        document.body.classList.remove('card-open');
    }

    function finishSwitchTo2D() {
        clearTimeout(morphTimeoutId);
        amapMode = true;
        if (view3d) view3d.hidden = true;
        if (view2d) view2d.hidden = false;
        document.body.classList.remove('mode-3d');
        document.body.classList.add('mode-2d');
        sceneModeBtn.textContent = '2D';   // 与原有语义一致：按钮显示当前模式
        setAutoRotate(false);              // 进入 2D 后停止地球自转
        viewer.clock.shouldAnimate = false;   // 地球隐藏时冻结昼夜光照，降低开销
        saveViewMode('2d');
        if (window.Footprint2D && typeof window.Footprint2D.show === 'function') {
            window.Footprint2D.show();
        }
        morphing = false;
        pendingMode = null;
    }

    // 2D 落地：展开飞到中国后，让高德页在地球下方先初始化，地图就绪后再交叉淡化，
    // 避免“平面地图 → 高德地图”的生硬切页。
    function begin2dCrossfade() {
        if (pendingMode !== '2d') return;
        let swapped = false;
        let readyGuard = null;
        const completeSwap = () => {
            if (swapped) return;
            swapped = true;
            clearTimeout(readyGuard);
            view3d.style.transition = 'opacity 0.45s ease';
            view2d.style.transition = 'opacity 0.45s ease';
            view3d.style.opacity = '0';
            view2d.style.opacity = '1';
            setTimeout(() => {
                view3d.style.transition = '';
                view3d.style.opacity = '';
                view2d.style.transition = '';
                view2d.style.opacity = '';
                finishSwitchTo2D();
            }, 480);
        };
        // 先让高德页在地球下方可见（透明）并初始化，地图就绪后再淡化
        view2d.hidden = false;
        view2d.style.opacity = '0';
        view3d.style.opacity = '1';
        if (window.Footprint2D && typeof window.Footprint2D.show === 'function') {
            window.Footprint2D.show(() => completeSwap());
            readyGuard = setTimeout(() => completeSwap(), 2500);   // 兜底：AMap 长时间未就绪也完成切换
        } else {
            completeSwap();
        }
    }

    function finishSwitchTo3D() {
        clearTimeout(morphTimeoutId);
        amapMode = false;
        if (view2d) view2d.hidden = true;
        if (view3d) view3d.hidden = false;
        document.body.classList.remove('mode-2d');
        document.body.classList.add('mode-3d');
        sceneModeBtn.textContent = '3D';   // 与原有语义一致：按钮显示当前模式
        viewer.clock.shouldAnimate = true;
        saveViewMode('3d');
        if (window.Footprint2D && typeof window.Footprint2D.hide === 'function') {
            window.Footprint2D.hide();
        }
        morphing = false;
        pendingMode = null;
    }

    // 切 2D：先让地球“展开”成平面，动画结束后再显示高德页面
    function switchTo2D() {
        if (amapMode || morphing) return;
        closeGlobeOverlays();
        if (reduceMotion) {   // 无障碍：关闭动画，直接切换
            finishSwitchTo2D();
            return;
        }
        morphing = true;
        pendingMode = '2d';
        armMorphTimeout();
        viewer.scene.morphTo2D(MORPH_DURATION);
    }

    // 切 3D：先显示仍处于平面状态的地球，再“合并”回球体
    function switchTo3D() {
        if (!amapMode || morphing) return;
        if (window.Footprint2D && typeof window.Footprint2D.hide === 'function') {
            window.Footprint2D.hide();
        }
        if (reduceMotion) {   // 无障碍：关闭动画，直接切换
            finishSwitchTo3D();
            return;
        }
        // 提前把视图换回地球（此时它处于上次 morphTo2D 后的平面状态），作为合并动画起点
        if (view2d) view2d.hidden = true;
        if (view3d) view3d.hidden = false;
        document.body.classList.remove('mode-2d');
        document.body.classList.add('mode-3d');
        viewer.resize();   // 容器刚从隐藏恢复，先校正画布尺寸，避免 morph 过程变形
        morphing = true;
        pendingMode = '3d';
        armMorphTimeout();
        viewer.scene.morphTo3D(MORPH_DURATION);
    }

    // morph 动画结束：按目标模式完成视图交换
    viewer.scene.morphComplete.addEventListener(() => {
        try {
            updateSceneModeBtn();
            if (pendingMode === '2d') {
                // 展开完成后保持平面地球可见，先平滑缩放到中国范围，再切换高德页面，
                // 避免直接从“整张平面世界地图”跳到“中国高德地图”的违和感。
                clearTimeout(morphTimeoutId);
                const ZOOM_DURATION = 1.2;   // 平面视角飞到中国范围的时长（秒）
                morphTimeoutId = setTimeout(() => {
                    if (pendingMode === '2d') begin2dCrossfade();
                }, ZOOM_DURATION * 1000 + 600);
                try {
                    animateCameraToRect(CHINA_VIEW, ZOOM_DURATION, () => {
                        clearTimeout(morphTimeoutId);
                        begin2dCrossfade();
                    });
                } catch (e) {
                    console.warn('平面视角定位失败：', e);
                    clearTimeout(morphTimeoutId);
                    begin2dCrossfade();
                }
            } else if (pendingMode === '3d') {
                finishSwitchTo3D();
                // 视角归位：morph 从平面回到球体后相机常贴近地表，地球会显得“扁”。
                // 不用 flyTo（飞行状态可能挂起导致无法拖拽），直接 setView 回到整球视角。
                viewer.camera.cancelFlight();   // 兜底：清理可能残留的飞行状态
                setAutoRotate(false);
                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
                });
                if (!reduceMotion) setAutoRotate(true);
            } else {
                morphing = false;
            }
        } catch (e) {
            console.error('2D/3D 切换失败：', e);
            morphing = false;
            pendingMode = null;
        }
    });

    sceneModeBtn.addEventListener('click', () => {
        if (amapMode) {
            switchTo3D();
        } else {
            switchTo2D();
        }
    });

    // 2D 视图：顶部导航栏隐藏，由高德页底部控制栏的“3D 地球”按钮切回 3D
    const back3dBtn = document.getElementById('back3dBtn');
    if (back3dBtn) {
        back3dBtn.addEventListener('click', () => {
            if (amapMode) switchTo3D();
        });
    }

    // ================= 自动旋转 =================
    const rotateBtn = document.getElementById('rotateBtn');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let autoRotate = false;

    // 拖动地球（位移超过 5px）后自动取消自动旋转；单纯点击不取消
    const cesiumCanvas = viewer.scene.canvas;
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;

    cesiumCanvas.addEventListener('pointerdown', (e) => {
        dragActive = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragActive = false; });
    window.addEventListener('pointercancel', () => { dragActive = false; });
    window.addEventListener('pointermove', (e) => {
        if (!dragActive || !autoRotate) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (dx * dx + dy * dy > 25) {      // 超过 5px 视为拖动
            dragActive = false;
            setAutoRotate(false);          // 拖动后取消自动旋转，需手动再开
        }
    }, { passive: true });

    // 鼠标悬停在地球表面时暂停自动旋转，移开（星空/空白/控件上方）即恢复。
    // 用相机射线与地球椭球求交判断光标是否在地球圆盘内：
    // 相交 = 在地球上；不相交 = 在星空/空白处。纯数学计算，无 GPU 开销。
    let hoverPaused = false;
    let lastHoverCheck = 0;
    const hoverCheckInterval = 60;   // 节流到约 16 次/秒，避免高频计算
    cesiumCanvas.addEventListener('pointermove', (e) => {
        if (!autoRotate || viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
            hoverPaused = false;
            return;
        }
        const now = performance.now();
        if (now - lastHoverCheck < hoverCheckInterval) return;
        lastHoverCheck = now;
        const rect = cesiumCanvas.getBoundingClientRect();
        const pos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
        const ray = viewer.camera.getPickRay(pos);
        // 与地球椭球求交：有交点 = 光标在地球圆盘内（IntersectionTests.rayEllipsoid）
        const interval = ray
            ? Cesium.IntersectionTests.rayEllipsoid(ray, viewer.scene.globe.ellipsoid)
            : undefined;
        hoverPaused = interval !== undefined;
    });
    cesiumCanvas.addEventListener('mouseleave', () => { hoverPaused = false; });

    function setAutoRotate(on) {
        autoRotate = on;
        lastRotateTime = null;               // 重新开启时从零计步，避免瞬移
        rotateBtn.textContent = on ? '暂停旋转' : '自动旋转';
        rotateBtn.classList.toggle('active', on);
        rotateBtn.setAttribute('aria-pressed', String(on));
    }

    rotateBtn.addEventListener('click', () => {
        if (reduceMotion) return;            // 系统减弱动效时不启用
        setAutoRotate(!autoRotate);
    });

    // ================= 城市高亮开关 =================
    // 默认关闭（首次加载不高亮），开启后放大到国内范围才显示填充+轮廓；
    // 选择用 localStorage 记住，刷新后保持。关闭时不加载/不渲染城市边界。
    const CITY_FILL_STORAGE_KEY = 'travelMemoryCityFill';
    function getSavedCityFill() {
        try { return localStorage.getItem(CITY_FILL_STORAGE_KEY) === '1'; } catch (e) { return false; }
    }
    function saveCityFill(on) {
        try { localStorage.setItem(CITY_FILL_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }
    let cityFillEnabled = getSavedCityFill();
    const cityFillBtn = document.getElementById('cityFillBtn');

    function applyCityFillBtnState() {
        cityFillBtn.classList.toggle('active', cityFillEnabled);
        cityFillBtn.setAttribute('aria-pressed', String(cityFillEnabled));
        cityFillFloatBtn.classList.toggle('active', cityFillEnabled);
        cityFillFloatBtn.setAttribute('aria-pressed', String(cityFillEnabled));
    }
    function setCityFillEnabled(on) {
        if (cityFillEnabled === on) return;
        cityFillEnabled = on;
        applyCityFillBtnState();
        saveCityFill(on);
        if (on) {
            buildCityFills();   // 开启后加载边界并显示（仍按缩放阈值显隐）
        } else {
            clearCityFills();   // 关闭时移除填充与轮廓
        }
    }
    applyCityFillBtnState();
    cityFillBtn.addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));
    cityFillFloatBtn.addEventListener('click', () => setCityFillEnabled(!cityFillEnabled));

    // 注意：Cesium 1.120 的 Clock 没有 deltaTime 属性（旧版本才有），
    // 这里用 performance.now() 自己计算真实时间差，避免得到 NaN 卡死页面。
    let lastRotateTime = null;

    viewer.clock.onTick.addEventListener(() => {
        if (!autoRotate) return;
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;  // 只在 3D 旋转
        if (hoverPaused) return;   // 鼠标悬停时暂停
        const now = performance.now();
        const dt = lastRotateTime === null ? 0 : Math.min((now - lastRotateTime) / 1000, 0.2);
        lastRotateTime = now;
        if (dt <= 0) return;
        try {
            viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -Cesium.Math.toRadians(2) * dt); // 2 度/秒
        } catch (e) {
            console.error('自动旋转出错：', e);
        }
    });

    // ================= 底图切换 =================
    // gcj: true 表示该底图基于 GCJ-02（高德），标记需从 WGS84 转换后再放置
    const baseProviders = {
        amapVec: { label: '高德矢量', providers: [amapVec], needKey: false, gcj: true },
        amapImg: { label: '高德卫星', providers: [amapImg, amapImgLabel], needKey: false, gcj: true },
        amapImgClean: { label: '高德卫星·无字', providers: [amapImg], needKey: false, gcj: true },
        tdtImg:  { label: '天地图影像', providers: [tdtImg, tdtCia], needKey: true, gcj: false },
        tdtVec:  { label: '天地图矢量', providers: [tdtVec, tdtCva], needKey: true, gcj: false },
        tdtImgClean:  { label: '天地图影像（无标注）', providers: [tdtImg], needKey: true, gcj: false },
        tdtVecClean:  { label: '天地图矢量（无标注）', providers: [tdtVec], needKey: true, gcj: false }
    };
    let currentBaseKey = null;   // 当前底图，供“重试”重新加载

    // 足迹标记数据（内置兜底，优先从 test.json 加载后替换）
    // coordType: 'gcj02' 表示坐标来自高德（火星坐标），'wgs84' 表示标准经纬度（天地图 CGCS2000 直接可用）
    let FOOTPRINTS = [
        {
            name: '北京',
            description: '从这里出发',
            address: '北京市',
            lng: 116.3914,
            lat: 39.9075,
            coordType: 'wgs84',
            city: '北京',
            provinceAdcode: '110000',
            cityAdcode: '110000',
            zoomLevel: 10,
            galleryImages: [
                { url: 'https://picsum.photos/seed/beijing-red-wall/800/800', caption: '红墙下的光影' },
                { url: 'https://picsum.photos/seed/beijing-night/800/800', caption: '长安街夜色' },
                { url: 'https://picsum.photos/seed/beijing-park/800/800', caption: '公园一角' }
            ]
        },
        {
            name: '稻城亚丁',
            description: '看蔚蓝的天，看白色的雪山，看金黄的草地，看一场秋天的童话',
            address: '甘孜藏族自治州稻城县稻城亚丁风景区',
            lng: 100.286793,   // 高德“甘孜稻城亚丁景区”POI 坐标
            lat: 28.458898,
            coordType: 'gcj02',   // 高德来源坐标（GCJ-02）
            city: '甘孜藏族自治州',
            provinceAdcode: '510000',
            cityAdcode: '513300',
            footprintType: '旅游',
            createTime: '2025-10-06',
            article: 'http://pyq.yunduan019.com/memo/20',
            zoomLevel: 12,
            image: 'http://tc.yunduan019.com/2025/10/09/IMG_7790.jpg!w100',
            galleryImages: [
                { url: 'http://tc.yunduan019.com/2025/10/09/IMG_7790.jpg!w100', caption: '看一场秋天的童话' },
                { url: 'https://picsum.photos/seed/yading-snow/800/800', caption: '雪山之下' },
                { url: 'https://picsum.photos/seed/yading-lake/800/800', caption: '高原海子' },
                { url: 'https://picsum.photos/seed/yading-meadow/800/800', caption: '金色草甸' }
            ]
        }
    ];

    // ================= 足迹数据加载（FOOTPRINT_CONFIG） =================
    // window.FOOTPRINT_CONFIG.footprints 为 Footprint CRD 数组（模板注入），坐标均为高德（GCJ-02）来源。
    // 加载失败时回退到上面的内置数据。
    function mapTestJsonEntry(entry) {
        const s = entry && entry.spec;
        if (!s || !s.name) return null;
        return {
            name: s.name,
            description: s.description || '',
            address: s.address || '',
            lng: Number(s.longitude),
            lat: Number(s.latitude),
            coordType: 'gcj02',   // test.json 坐标均为高德（GCJ-02）来源
            city: s.city || '',
            provinceAdcode: String(s.provinceAdcode || ''),
            cityAdcode: String(s.cityAdcode || ''),
            footprintType: s.footprintType || '',
            createTime: formatTestDate(s.createTime),
            article: s.article || '',
            zoomLevel: Number(s.zoomLevel) || 12,
            image: s.image || '',
            ticketImage: s.ticketImage || '',
            ticketTitle: s.ticketTitle || '',
            ticketSubtitle: s.ticketSubtitle || '',
            ticketDate: s.ticketDate || '',
            ticketRoute: s.ticketRoute || '',
            ticketNo: s.ticketNo || '',
            ticketType: s.ticketType || '',
            galleryImages: (s.galleryImages || []).map(g => ({ url: g.url, caption: '' }))
        };
    }

    // createTime 兼容两种格式：test.json 的 "01/05/2026 01:04:00"（MM/DD/YYYY）与
    // FOOTPRINT_CONFIG 注入的 ISO 格式 "2026-01-05T01:04:00Z"，统一转成 YYYY-MM-DD
    function formatTestDate(str) {
        if (!str) return '';
        const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
        if (m) return m[3] + '-' + m[1] + '-' + m[2];
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
        return iso ? iso[1] + '-' + iso[2] + '-' + iso[3] : str;
    }

    // 足迹数据源：优先使用模板注入的 window.FOOTPRINT_CONFIG.footprints（与原高德页面同源），
    // 失败时返回 null，由调用方回退到内置兜底数据。
    async function loadFootprintsFromJson() {
        try {
            const cfg = window.FOOTPRINT_CONFIG || {};
            const list = Array.isArray(cfg.footprints) ? cfg.footprints : [];
            const mapped = list.map(mapTestJsonEntry).filter(Boolean);
            if (!mapped.length) throw new Error('FOOTPRINT_CONFIG 中没有有效足迹');
            return mapped;
        } catch (e) {
            console.warn('足迹配置加载失败，使用内置数据：', e);
            return null;
        }
    }

    // 用加载到的数据替换内置数组（保持数组引用不变，各处引用自动生效）
    function applyFootprints(loaded) {
        if (!loaded || !loaded.length) return false;
        FOOTPRINTS.length = 0;
        FOOTPRINTS.push(...loaded);
        return true;
    }

    // 统计区：总足迹数 / 去过的城市数（数据驱动）
    function updateIntroStats() {
        const total = document.getElementById('introTotal');
        const cities = document.getElementById('introCities');
        if (total) total.textContent = FOOTPRINTS.length;
        if (cities) cities.textContent = new Set(FOOTPRINTS.map(f => f.city).filter(Boolean)).size;
    }
    updateIntroStats();

    let markerEntities = [];
    let currentPositions = [];

    // 标记悬停气泡与键盘焦点层（提前声明：applyMarkerMode 初始化时就会用到）
    const markerTip = document.getElementById('markerTip');
    const markerTipName = document.getElementById('markerTipName');
    const markerFocusLayer = document.getElementById('markerFocusLayer');
    let markerTipEntity = null;
    let lastKeyboardMarkerBtn = null;

    // ================= 城市聚合（整球显示城市标记，放大后展开为单个足迹） =================
    // 城市标记图标：白色圆环 + 中心数量
    function cityMarkerUrl(count) {
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">' +
            '<circle cx="28" cy="28" r="22" fill="#ffffff" opacity="0.01"/>' +
            '<circle cx="28" cy="28" r="22" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.9"/>' +
            '<text x="28" y="31" fill="#f7f5f1" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="15" text-anchor="middle">' + count + '</text>' +
            '</svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    // 城市中心 = 该城市所有足迹在“当前底图坐标系”下的平均位置
    function cityCenter(city) {
        let lng = 0, lat = 0, n = 0;
        city.indices.forEach(i => {
            const p = currentPositions[i];
            if (p) { lng += p.lng; lat += p.lat; n++; }
        });
        return n ? { lng: lng / n, lat: lat / n } : null;
    }

    let terrainNote = hasTDTKey ? '，未启用三维地形' : '，未配置天地图 Key（无地形）';

    // 状态栏文案：当前底图 + 坐标系 + 地形状态 + 足迹数
    function updateStatusText() {
        const item = currentBaseKey ? baseProviders[currentBaseKey] : null;
        const coordName = item && item.gcj ? 'GCJ-02' : 'CGCS2000/WGS84';
        statusText.textContent =
            (item ? item.label + '底图' : '底图') + `（${coordName}）${terrainNote}` +
            ` · ${FOOTPRINTS.length} 个足迹标记 · 地图数据 © 高德 / 天地图`;
    }

    // 把一条足迹从它自己的坐标系转换到当前底图坐标系：
    // 高德底图基于 GCJ-02，天地图底图基于 CGCS2000（≈WGS84）。
    function footprintToBasemap(fp, basemapIsGcj) {
        if (fp.coordType === 'gcj02') {
            // 高德来源：高德底图直接用原坐标，天地图底图转成 WGS84
            return basemapIsGcj
                ? { lng: fp.lng, lat: fp.lat }
                : gcj02ToWgs84(fp.lng, fp.lat);
        }
        // WGS84 来源：天地图底图直接用，高德底图转成 GCJ-02
        return basemapIsGcj
            ? wgs84ToGcj02(fp.lng, fp.lat)
            : { lng: fp.lng, lat: fp.lat };
    }

    // 按当前底图坐标系刷新所有标记
    function applyMarkerPositions(key) {
        const item = baseProviders[key];
        const basemapIsGcj = !!(item && item.gcj);
        currentPositions = FOOTPRINTS.map(fp => footprintToBasemap(fp, basemapIsGcj));
        markerEntities.forEach((ent, i) => {
            const pos = currentPositions[i];
            if (ent && pos) {
                ent.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat);
            }
        });
        // 城市标记同步到新的平均位置
        cityMarkerEntities.forEach((ent, i) => {
            const center = cityList[i] && cityCenter(cityList[i]);
            if (ent && center) {
                ent.position = Cesium.Cartesian3.fromDegrees(center.lng, center.lat);
            }
        });
        return currentPositions;
    }

    // 底图选择持久化：localStorage 保存，刷新后继续使用上次选择的底图
    const BASE_STORAGE_KEY = 'travelMemoryBaseMap';
    function getSavedBase() {
        try { return localStorage.getItem(BASE_STORAGE_KEY) || ''; } catch (e) { return ''; }
    }
    function saveBase(key) {
        try { localStorage.setItem(BASE_STORAGE_KEY, key); } catch (e) { /* 忽略 */ }
    }
    // 初始底图：优先使用上次保存且当前可用的底图，否则默认使用“高德卫星·无字”
    function resolveInitialBase() {
        const saved = getSavedBase();
        if (saved && baseProviders[saved] && (!baseProviders[saved].needKey || hasTDTKey)) {
            return saved;
        }
        return 'amapImgClean';
    }

    function switchBase(key) {
        const item = baseProviders[key];
        if (!item || (item.needKey && !hasTDTKey)) return;

        currentBaseKey = key;
        saveBase(key);   // 记住当前底图，刷新后保持
        tileErrorShown = false;
        statusRetry.hidden = true;

        viewer.imageryLayers.removeAll();
        for (const provider of item.providers) {
            if (provider) {
                viewer.imageryLayers.addImageryProvider(provider);
                attachTileError(provider);   // 瓦片失败走 provider.errorEvent
            }
        }

        for (const [k, btn] of Object.entries(btnMap)) {
            btn.classList.toggle('active', k === key);
        }
        applyMarkerPositions(key);
        if (cityFillEnabled) buildCityFills();   // 城市高亮随底图坐标系重建（天地图需转 WGS84）
        updateStatusText();
    }

    document.querySelectorAll('#layerButtons button').forEach(btn => {
        btn.addEventListener('click', () => switchBase(btn.dataset.key));
    });

    // 底图下拉菜单：点击开关、选择后收起、点击外部或按 Esc 关闭
    const layerMenu = document.getElementById('layerMenu');
    const layerMenuBtn = document.getElementById('layerMenuBtn');
    const layerPanel = document.getElementById('layerButtons');

    layerMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = layerPanel.hidden;
        layerPanel.hidden = !open;
        layerMenuBtn.setAttribute('aria-expanded', String(!open));
        layerMenu.classList.toggle('open', !open);
    });

    layerPanel.addEventListener('click', () => {
        layerPanel.hidden = true;
        layerMenuBtn.setAttribute('aria-expanded', 'false');
        layerMenu.classList.remove('open');
    });

    document.addEventListener('click', (e) => {
        if (!layerPanel.hidden && !layerMenu.contains(e.target)) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        // 灯箱打开时：← / → 切换图片
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && lightbox.classList.contains('show')) {
            switchLightbox(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (e.key !== 'Escape') return;
        if (!layerPanel.hidden) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
            return;
        }
        if (lightbox.classList.contains('show')) {
            closeLightbox();
            return;
        }
        if (cityView.classList.contains('show')) {
            closeCityView();
            return;
        }
        if (albumOverlay.classList.contains('show')) {
            closeAlbum();
            return;
        }
        if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
        }
    });

    // 默认底图：优先恢复上次保存的选择，否则用天地图影像（无标注）/ 高德卫星
    switchBase(resolveInitialBase());

    // ================= 天地图三维地形（可选开关，默认关闭） =================
    // 注意：这是专有地形格式，Cesium.sampleTerrain 对它不适用；主要覆盖国内范围（级别 5-12 左右）。
    // 天地图 Key 绑定域名白名单（未授权返回 403），且地形与影像/矢量共用每日配额（429）。
    // 因此默认不启用地形；导航栏「三维地形」开启时先探测授权，成功才启用，失败自动回退平面。
    const terrainBtn = document.getElementById('terrainBtn');
    const TDT_TERRAIN_STORAGE_KEY = 'travelMemoryTerrain';
    function getSavedTerrain() {
        try { return localStorage.getItem(TDT_TERRAIN_STORAGE_KEY) === '1'; } catch (e) { return false; }
    }
    function saveTerrain(on) {
        try { localStorage.setItem(TDT_TERRAIN_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }
    let terrainEnabled = false;    // 实际启用状态（探测成功后才为 true）
    let terrainPending = false;    // 防止探测期间重复点击

    function applyTerrainBtnState() {
        terrainBtn.classList.toggle('active', terrainEnabled);
        terrainBtn.setAttribute('aria-pressed', String(terrainEnabled));
    }

    function setTdtTerrain(on) {
        if (terrainPending) return;
        if (!on) {
            terrainEnabled = false;
            saveTerrain(false);
            terrainNote = '，未启用三维地形';
            viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
            applyTerrainBtnState();
            updateStatusText();
            return;
        }
        if (!hasTDTKey || typeof TdtPlug === 'undefined' || !TdtPlug.GeoTerrainProvider) {
            terrainBtn.disabled = true;
            return;
        }
        terrainPending = true;
        fetch('https://t0.tianditu.gov.cn/mapservice/swdx?T=elv_c&x=211&y=36&l=8&tk=' + TDT_KEY)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const provider = new TdtPlug.GeoTerrainProvider({
                    url: 'https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&x={x}&y={y}&l={z}&tk=' + TDT_KEY,
                    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7']
                });
                // 天地图高程仅覆盖中国范围，且 Cesium 1.120 的 CustomHeightmapTerrainProvider
                // 不读 rectangle 选项。覆盖 getTileDataAvailable：境外/超深瓦片返回 false，
                // Cesium 直接标记为不可用而不发起请求，避免“无效数据”报错刷屏。
                const chinaRect = Cesium.Rectangle.fromDegrees(72.0, 0.5, 138.5, 56.5);
                provider.getTileDataAvailable = function (x, y, level) {
                    try {
                        if (level < 5) return true;    // 低级别插件返回平面缓冲，始终可用（保证球面能构建）
                        if (level >= 12) return false; // 插件 12 级及以上不发送请求
                        const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
                        return Cesium.Rectangle.contains(chinaRect, Cesium.Rectangle.center(rect));
                    } catch (e) {
                        return true;   // 异常时放行给插件原有逻辑，避免影响渲染
                    }
                };
                viewer.terrainProvider = provider;
                terrainEnabled = true;
                terrainNote = '，已启用天地图三维地形';
                saveTerrain(true);
            })
            .catch(e => {
                terrainEnabled = false;
                saveTerrain(false);
                terrainNote = '，未启用三维地形（Key 未授权当前域名或未开通地形服务）';
                console.warn('天地图三维地形不可用，使用平面地球：', e.message || e);
                statusText.textContent =
                    '三维地形不可用：天地图 Key 未授权当前域名或未开通地形服务。' +
                    '请在天地图控制台把当前域名加入白名单后重试。';
            })
            .finally(() => {
                terrainPending = false;
                applyTerrainBtnState();
                updateStatusText();
            });
    }

    terrainBtn.addEventListener('click', () => setTdtTerrain(!terrainEnabled));
    if (!hasTDTKey || typeof TdtPlug === 'undefined' || !TdtPlug.GeoTerrainProvider) {
        terrainBtn.disabled = true;
    } else {
        terrainBtn.disabled = false;
    }
    // 初始化：恢复上次选择（默认关闭，不请求任何地形瓦片）
    // 初始化：恢复上次选择；未选择过时按后台“默认启用三维地形”配置
    if (getSavedTerrain() || (window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.enableTerrainDefault)) {
        setTdtTerrain(true);
    }
    applyTerrainBtnState();

    // ================= 初始视角与开场动画 =================
    // 首次加载：地球从另一侧（太平洋方向）旋转入场，飞到“中国朝向”的整球视图，
    // 动画结束再开启自动旋转；尊重系统减弱动效，2D 模式恢复时不播动画。
    function playEntranceAnimation() {
        entranceActive = true;
        const startLng = -60, startLat = 30, startH = 25000000;   // 从太平洋一侧开始
        const endLng = 104.0, endLat = 35.0, endH = 21000000;     // 中国大致中心，整球可见
        const duration = 2.6;   // 秒
        const startTime = performance.now();

        const cancelEntrance = () => {
            if (!entranceActive) return;
            entranceActive = false;
            viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(endLng, endLat, endH) });
            if (!reduceMotion) setAutoRotate(true);
        };
        // 用户拖动/滚轮交互时立即结束入场动画，避免相机被“抢”
        cesiumCanvas.addEventListener('pointerdown', cancelEntrance);
        cesiumCanvas.addEventListener('wheel', cancelEntrance, { passive: true });

        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(startLng, startLat, startH) });
        function tick(now) {
            if (!entranceActive) return;
            const t = Math.min((now - startTime) / (duration * 1000), 1);
            const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(
                    startLng + (endLng - startLng) * k,
                    startLat + (endLat - startLat) * k,
                    startH + (endH - startH) * k
                )
            });
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                entranceActive = false;
                if (!reduceMotion) setAutoRotate(true);   // 入场完成后再开始自转
            }
        }
        requestAnimationFrame(tick);
    }

    if (reduceMotion || getSavedViewMode() === '2d') {
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000) // 中国大致中心，整球可见
        });
    } else {
        playEntranceAnimation();
    }

    // ================= 足迹标记点 =================
    // 样式：中间白色实心圆点 + 外围白色圆环，圆环与圆点之间留空隙（内联 SVG data URI）。
    // 初始底图已在 switchBase 中确定，currentPositions 已按底图坐标系转换好。

    const MARKER_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">' +
        // 透明填充（opacity 0.01）：让圆点与圆环之间的空白也能被拾取，
        // 视觉上不可见；Cesium 拾取时 alpha 为 0 的像素会被丢弃。
        '<circle cx="28" cy="28" r="22" fill="#ffffff" opacity="0.01"/>' +
        '<circle cx="28" cy="28" r="22" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.9"/>' +
        '<circle cx="28" cy="28" r="8" fill="#ffffff" stroke="#1a2029" stroke-width="2"/>' +
        '</svg>';
    const MARKER_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MARKER_SVG);

    // 创建全部标记（数据加载完成后会重建）
    function buildMarkers() {
        markerEntities = FOOTPRINTS.map((fp, i) => {
            const pos = currentPositions[i] || { lng: fp.lng, lat: fp.lat };
            return viewer.entities.add({
                name: fp.name,
                position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat),
                billboard: {
                    image: MARKER_URL,
                    width: 25,
                    height: 25,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
                }
            });
        });
    }

    // 构建城市聚合标记（每个城市一个，中心取足迹平均位置）
    function buildCityMarkers() {
        cityList = [];
        const map = new Map();
        FOOTPRINTS.forEach((fp, i) => {
            const city = fp.city || '未分类';
            if (!map.has(city)) {
                map.set(city, []);
                cityList.push({ city, indices: map.get(city) });
            }
            map.get(city).push(i);
        });
        cityMarkerEntities.forEach(ent => viewer.entities.remove(ent));
        cityMarkerEntities = cityList.map(city => {
            const center = cityCenter(city);
            return viewer.entities.add({
                name: city.city,
                position: center ? Cesium.Cartesian3.fromDegrees(center.lng, center.lat) : undefined,
                billboard: {
                    image: cityMarkerUrl(city.indices.length),
                    width: 30,
                    height: 30,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY   // 背面隐藏由 updateMarkerOcclusion 处理
                }
            });
        });
    }

    // 切换 城市聚合 / 展开单个足迹 模式
    function applyMarkerMode(city) {
        cityMode = city;
        cityMarkerEntities.forEach(ent => { ent.show = city; });
        markerEntities.forEach(ent => { ent.show = !city; });
        buildMarkerFocusButtons();
        hideMarkerTip();
    }

    buildMarkers();
    buildCityMarkers();
    applyMarkerMode(true);   // 初始整球视图：城市聚合

    // ================= 标记交互：悬停显示名称，点击打开详情卡 =================
    const markerCard = document.getElementById('markerCard');
    const markerCardMedia = document.getElementById('markerCardMedia');
    const markerCardTitle = document.getElementById('markerCardTitle');
    const markerCardMeta = document.getElementById('markerCardMeta');
    const markerCardAddr = document.getElementById('markerCardAddr');
    const markerCardDesc = document.getElementById('markerCardDesc');
    const markerCardLink = document.getElementById('markerCardLink');
    markerCardReady = true;   // 标记卡已就绪，可响应整球视图自动关闭
    let activeFootprintIndex = -1;
    let markerRestoreRaf = null;

    function setMarkerSelected(index) {
        if (markerRestoreRaf) {
            cancelAnimationFrame(markerRestoreRaf);
            markerRestoreRaf = null;
        }
        markerEntities.forEach((ent, i) => {
            const sel = i === index;
            ent.billboard.width = sel ? 34 : 25;
            ent.billboard.height = sel ? 34 : 25;
            ent.billboard.color = sel ? Cesium.Color.WHITE : Cesium.Color.WHITE.withAlpha(0.42);
        });
    }

    // 关闭卡片时，标记圆点/光圈与卡片淡出同节奏复原。
    // 注意：billboard.width/color 读回的是 Property 包装对象，不能直接当数值用，
    // 所以起点状态用代码里记录的选中项（34px/全亮，其他 25px/42% 透明度）。
    function restoreMarkers(duration, selIndex) {
        if (markerRestoreRaf) {
            cancelAnimationFrame(markerRestoreRaf);
            markerRestoreRaf = null;
        }
        const start = performance.now();
        function tick(now) {
            const t = Math.min((now - start) / duration, 1);
            const k = t * t * (3 - 2 * t);   // smoothstep 缓动
            markerEntities.forEach((ent, i) => {
                const fromW = (i === selIndex) ? 34 : 25;
                const fromA = (i === selIndex) ? 1.0 : 0.42;
                ent.billboard.width = fromW + (25 - fromW) * k;
                ent.billboard.height = fromW + (25 - fromW) * k;
                ent.billboard.color = Cesium.Color.WHITE.withAlpha(fromA + (1 - fromA) * k);
            });
            if (t < 1) {
                markerRestoreRaf = requestAnimationFrame(tick);
            } else {
                markerRestoreRaf = null;
            }
        }
        markerRestoreRaf = requestAnimationFrame(tick);
    }

    function hideMarkerCard() {
        document.body.classList.remove('card-open');   // 恢复右下角浮动按钮
        if (!markerCard.classList.contains('visible')) return;
        markerCard.classList.remove('visible');
        markerCard.setAttribute('aria-hidden', 'true');
        const selIndex = activeFootprintIndex;   // 先记录再置空，供复原动画使用
        activeFootprintIndex = -1;
        if (reduceMotion) {
            markerEntities.forEach(ent => {
                ent.billboard.width = 25;
                ent.billboard.height = 25;
                ent.billboard.color = Cesium.Color.WHITE;
            });
        } else {
            restoreMarkers(450, selIndex);   // 与卡片淡出时长一致
        }
        // 键盘关闭后，把焦点还给触发打开的标记按钮
        if (lastKeyboardMarkerBtn && markerCard.contains(document.activeElement)) {
            lastKeyboardMarkerBtn.focus();
            lastKeyboardMarkerBtn = null;
        }
    }

    // ================= 详情卡主图：加载成功显示图片，失败回退首字占位 + 重试 =================
    let cardImgLoadId = 0;   // 防止快速切换卡片时旧请求覆盖新图

    function showCardMonogram(fp, showRetry) {
        markerCardMedia.classList.add('no-image');
        markerCardMedia.style.backgroundImage = 'none';
        markerCardMedia.innerHTML =
            '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>' +
            (showRetry ? '<button class="marker-card-retry" type="button">重试</button>' : '');
        if (showRetry) {
            markerCardMedia.querySelector('.marker-card-retry').addEventListener('click', (e) => {
                e.stopPropagation();
                const f = FOOTPRINTS[activeFootprintIndex];
                if (f && f.image) loadCardImage(f);
            });
        }
    }

    function loadCardImage(fp) {
        const myId = ++cardImgLoadId;
        markerCardMedia.classList.add('no-image');
        markerCardMedia.style.backgroundImage = 'none';
        markerCardMedia.innerHTML =
            '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>';
        const img = new Image();
        img.onload = () => {
            if (myId !== cardImgLoadId) return;   // 已被更新的卡片取代
            markerCardMedia.classList.remove('no-image');
            markerCardMedia.style.backgroundImage = 'url("' + fp.image + '")';
            markerCardMedia.innerHTML = '';
        };
        img.onerror = () => {
            if (myId !== cardImgLoadId) return;
            showCardMonogram(fp, true);   // 图片失败：首字占位 + 重试
        };
        img.src = fp.image;
    }

    function showMarkerCard(fp, index) {
        activeFootprintIndex = index;
        markerCardTitle.textContent = fp.name;
        markerCardAddr.textContent = fp.address || '';
        markerCardDesc.textContent = fp.description || '';

        const metaParts = [];
        if (fp.footprintType) metaParts.push(fp.footprintType);
        if (fp.city) metaParts.push(fp.city);
        if (fp.createTime) metaParts.push(fp.createTime);
        markerCardMeta.textContent = metaParts.join(' / ');
        markerCardMeta.hidden = metaParts.length === 0;

        if (fp.article) {
            markerCardLink.href = fp.article;
            markerCardLink.hidden = false;
        } else {
            markerCardLink.removeAttribute('href');
            markerCardLink.hidden = true;
        }

        if (fp.image) {
            loadCardImage(fp);
        } else {
            showCardMonogram(fp, false);
        }

        setMarkerSelected(index);
        markerCard.classList.add('visible');
        document.body.classList.add('card-open');   // 隐藏右下角浮动按钮，避免遮挡
        markerCard.setAttribute('aria-hidden', 'false');
    }

    document.getElementById('markerCardClose').addEventListener('click', hideMarkerCard);

    // 定位：相机缓动飞到该足迹（按数据的 zoomLevel 计算高度）
    document.getElementById('markerCardLocate').addEventListener('click', () => {
        if (activeFootprintIndex < 0 || !currentPositions[activeFootprintIndex]) return;
        const fp = FOOTPRINTS[activeFootprintIndex];
        const pos = currentPositions[activeFootprintIndex];
        const height = fp.zoomLevel
            ? (156543.03392 * Math.cos(Cesium.Math.toRadians(pos.lat))) / Math.pow(2, fp.zoomLevel) * 1000
            : 120000;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, height),
            duration: 2.2
        });
    });

    // ================= 悬停名称（标注式引导线，跟随标记） =================

    // 悬停/键盘聚焦时：其他标记变暗、城市轮廓透明度降低，只有当前标记保持全亮
    function setMarkerFocus(entity) {
        if (focusedMarker === entity) return;
        focusedMarker = entity;
        const outlineMat = Cesium.Color.WHITE.withAlpha(entity ? 0.2 : 0.4);
        cityOutlinePolylines.forEach(p => { if (p) p.material = outlineMat; });
        const dim = Cesium.Color.WHITE.withAlpha(0.35);
        markerEntities.forEach(ent => {
            if (ent && ent.billboard) {
                ent.billboard.color = (entity && entity !== ent) ? dim : Cesium.Color.WHITE;
            }
        });
        cityMarkerEntities.forEach(ent => {
            if (ent && ent.billboard) {
                ent.billboard.color = (entity && entity !== ent) ? dim : Cesium.Color.WHITE;
            }
        });
    }

    function showMarkerTip(entity, text) {
        markerTipEntity = entity;
        markerTipName.textContent = text;
        markerTip.classList.add('show');
        setMarkerFocus(entity);
        updateMarkerTipPosition();
    }

    function hideMarkerTip() {
        markerTipEntity = null;
        markerTip.classList.remove('show');
        setMarkerFocus(null);
    }

    // 每帧把名称钉在标记旁边（标记随地球转动/底图切换而移动）
    function updateMarkerTipPosition() {
        if (!markerTipEntity) return;
        const ent = markerTipEntity;
        if (!ent) return;
        const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
        if (!pos) return;
        // 标记转到地球背面时，隐藏悬停标注（与标记遮挡保持一致）
        const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
        const toCamera = Cesium.Cartesian3.subtract(viewer.camera.positionWC, pos, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(normal, toCamera) < 0) {
            hideMarkerTip();
            return;
        }
        const screenPos = pos && Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
        if (!screenPos) return;
        // 先按右侧布局测量；靠近屏幕右缘时镜像到标记左侧
        markerTip.classList.remove('left');
        const w = markerTip.offsetWidth;
        const h = markerTip.offsetHeight;
        const placeLeft = screenPos.x + 4 + w > window.innerWidth - 8;
        let x, y;
        if (placeLeft) {
            markerTip.classList.add('left');
            x = screenPos.x - 4 - markerTip.offsetWidth;
        } else {
            x = screenPos.x + 4;
        }
        x = Math.max(8, Math.min(x, window.innerWidth - markerTip.offsetWidth - 8));
        y = Math.max(8, Math.min(screenPos.y - h / 2, window.innerHeight - h - 8));
        markerTip.style.left = x + 'px';
        markerTip.style.top = y + 'px';
    }
    viewer.scene.postRender.addEventListener(updateMarkerTipPosition);

    // 标记可见性：转到地球背面（越过地平线）立即隐藏，转回正面再出现。
    // 与悬停标注同一套半球算法，行为可控且不依赖深度缓冲。
    const occNormal = new Cesium.Cartesian3();
    const occToCam = new Cesium.Cartesian3();
    function updateMarkerOcclusion() {
        const mode3D = viewer.scene.mode === Cesium.SceneMode.SCENE3D;
        const cam = viewer.camera.positionWC;
        function setVisible(ent, want) {
            if (!want) { ent.show = false; return; }
            const p = ent.position && ent.position.getValue(Cesium.JulianDate.now());
            if (!p) { ent.show = false; return; }
            if (!mode3D) { ent.show = true; return; }
            Cesium.Cartesian3.normalize(p, occNormal);
            Cesium.Cartesian3.subtract(cam, p, occToCam);
            ent.show = Cesium.Cartesian3.dot(occNormal, occToCam) > 0;   // 越过地平线即隐藏
        }
        cityMarkerEntities.forEach(ent => setVisible(ent, cityMode));
        markerEntities.forEach(ent => setVisible(ent, !cityMode));
    }
    viewer.scene.postRender.addEventListener(updateMarkerOcclusion);

    const markerPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 判断拾取到的是单个足迹还是城市标记
    function findPickedMarker(picked) {
        if (!picked || !picked.id) return null;
        const fi = markerEntities.indexOf(picked.id);
        if (fi >= 0) return { type: 'footprint', index: fi };
        const ci = cityMarkerEntities.indexOf(picked.id);
        if (ci >= 0) return { type: 'city', index: ci };
        return null;
    }

    // 单个足迹的悬停文案：名称 · 城市（无城市则只显示名称）
    function footprintTipText(fp) {
        return fp.city ? fp.name + ' · ' + fp.city : fp.name;
    }

    // 悬停：足迹显示名称，城市显示「城市 · N 个足迹」
    markerPickHandler.setInputAction((movement) => {
        const found = findPickedMarker(viewer.scene.pick(movement.endPosition));
        if (found && found.type === 'footprint') {
            showMarkerTip(markerEntities[found.index], footprintTipText(FOOTPRINTS[found.index]));
        } else if (found && found.type === 'city') {
            const city = cityList[found.index];
            showMarkerTip(cityMarkerEntities[found.index], city.city + ' · ' + city.indices.length + ' 个足迹');
        } else {
            hideMarkerTip();
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 鼠标离开画布时收起名称气泡
    viewer.scene.canvas.addEventListener('mouseleave', hideMarkerTip);

    // 点击足迹打开详情卡；点击城市标记飞入展开；点击空白处关闭
    markerPickHandler.setInputAction((movement) => {
        const found = findPickedMarker(viewer.scene.pick(movement.position));
        if (found && found.type === 'footprint') {
            showMarkerCard(FOOTPRINTS[found.index], found.index);
        } else if (found && found.type === 'city') {
            openCityView(found.index);
        } else if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ================= 标记键盘可达（Tab 聚焦 → Enter 打开详情卡） =================
    // 每个标记对应一个屏幕外按钮；聚焦时在球面上亮出该标记名称，
    // 键盘激活后焦点移入详情卡，关闭时再回到标记按钮。
    function buildMarkerFocusButtons() {
        markerFocusLayer.innerHTML = '';
        if (cityMode) {
            // 城市模式：聚焦显示「城市 · N 个足迹」，Enter 飞入展开
            cityList.forEach((city, ci) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'marker-focus-btn';
                const label = city.city + ' · ' + city.indices.length + ' 个足迹';
                btn.textContent = '查看' + label;
                btn.addEventListener('focus', () => {
                    showMarkerTip(cityMarkerEntities[ci], label);
                });
                btn.addEventListener('blur', hideMarkerTip);
                btn.addEventListener('click', (e) => {
                    openCityView(ci, e.detail === 0 ? btn : null);
                });
                markerFocusLayer.appendChild(btn);
            });
            return;
        }
        // 展开模式：单个足迹，聚焦显示名称，Enter 打开详情卡
        FOOTPRINTS.forEach((fp, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'marker-focus-btn';
            btn.textContent = '查看' + fp.name + '足迹详情';
            btn.addEventListener('focus', () => {
                showMarkerTip(markerEntities[i], footprintTipText(fp));
            });
            btn.addEventListener('blur', hideMarkerTip);
            btn.addEventListener('click', (e) => {
                showMarkerCard(fp, i);
                if (e.detail === 0) {   // 键盘激活（detail=0），鼠标点击不会跳焦点
                    lastKeyboardMarkerBtn = btn;
                    document.getElementById('markerCardClose').focus();
                }
            });
            markerFocusLayer.appendChild(btn);
        });
    }
    // 初始按钮由 applyMarkerMode(true) 在标记构建后生成

    // ================= 全屏相册（城市 → 足迹 → 图片组） =================
    const albumOverlay = document.getElementById('albumOverlay');
    const albumBody = document.getElementById('albumBody');
    const albumBtn = document.getElementById('albumBtn');
    const albumClose = document.getElementById('albumClose');

    // 按城市聚合足迹（保持数据顺序）
    function groupFootprintsByCity() {
        const order = [];
        const map = new Map();
        FOOTPRINTS.forEach(fp => {
            const city = fp.city || '未分类';
            if (!map.has(city)) {
                map.set(city, []);
                order.push(city);
            }
            map.get(city).push(fp);
        });
        return order.map(city => ({ city, footprints: map.get(city) }));
    }

    function renderAlbum() {
        albumBody.innerHTML = '';
        let tileIndex = 0;
        groupFootprintsByCity().forEach(group => {
            const section = document.createElement('section');
            section.className = 'album-city';

            const head = document.createElement('div');
            head.className = 'album-city-head';
            const cityName = document.createElement('span');
            cityName.className = 'album-city-name';
            cityName.textContent = group.city;
            const cityCount = document.createElement('span');
            cityCount.className = 'album-city-count';
            const totalImgs = group.footprints.reduce(
                (n, fp) => n + cityWallImages(fp).length, 0
            );
            cityCount.textContent = group.footprints.length + ' 个足迹 · ' + totalImgs + ' 张照片';
            head.append(cityName, cityCount);
            section.appendChild(head);

            group.footprints.forEach(fp => {
                const block = document.createElement('div');
                block.className = 'album-footprint';

                const fpH = document.createElement('div');
                fpH.className = 'album-fp-head';
                const nameEl = document.createElement('span');
                nameEl.className = 'album-fp-name';
                nameEl.textContent = fp.name;
                const dateEl = document.createElement('span');
                dateEl.className = 'album-fp-date';
                dateEl.textContent = formatCityDate(fp.createTime);
                fpH.append(nameEl, dateEl);
                block.appendChild(fpH);

                const grid = document.createElement('div');
                grid.className = 'album-grid';
                const imgs = cityWallImages(fp);
                if (imgs.length) {
                    imgs.forEach((img, idx) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'album-tile';
                        btn.style.setProperty('--tile-i', tileIndex++);
                        btn.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
                        const photo = document.createElement('img');
                        photo.loading = 'lazy';
                        photo.src = img.url;
                        photo.alt = img.caption || fp.name;
                        btn.appendChild(photo);
                        btn.addEventListener('click', () => openLightbox(fp, idx, btn));
                        grid.appendChild(btn);
                    });
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'album-empty';
                    empty.textContent = '暂无照片';
                    grid.appendChild(empty);
                }
                block.appendChild(grid);
                section.appendChild(block);
            });
            albumBody.appendChild(section);
        });
    }

    function openAlbum() {
        if (cityView.classList.contains('show')) closeCityView(false);
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        hideMarkerTip();
        renderAlbum();
        albumOverlay.classList.add('show');
        albumOverlay.setAttribute('aria-hidden', 'false');
        albumClose.focus();
    }

    function closeAlbum(returnFocus = true) {
        if (lightbox.classList.contains('show')) closeLightbox();
        albumOverlay.classList.remove('show');
        albumOverlay.setAttribute('aria-hidden', 'true');
        if (returnFocus && albumBtn) albumBtn.focus();
    }

    if (albumBtn) albumBtn.addEventListener('click', openAlbum);
    albumClose.addEventListener('click', () => closeAlbum());
    // 点击覆盖层空白处（内容区之外的左右留白）关闭
    albumOverlay.addEventListener('click', (e) => {
        if (e.target === albumOverlay) closeAlbum();
    });

    // ================= 图片灯箱 =================
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCount = document.getElementById('lightboxCount');
    const lightboxCaption = document.getElementById('lightboxCaption');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxStage = document.getElementById('lightboxStage');
    const lightboxSkeleton = document.getElementById('lightboxSkeleton');
    const lightboxError = document.getElementById('lightboxError');
    const lightboxRetry = document.getElementById('lightboxRetry');
    const lightboxMap = document.getElementById('lightboxMap');
    let lightboxFp = null;
    let lightboxIndex = 0;
    let lightboxTriggerBtn = null;

    function lightboxImages() {
        return lightboxFp ? cityWallImages(lightboxFp) : [];
    }

    function loadLightboxImage(url) {
        lightboxSkeleton.hidden = false;
        lightboxError.hidden = true;
        lightboxImg.hidden = false;
        lightboxImg.onload = () => { lightboxSkeleton.hidden = true; };
        lightboxImg.onerror = () => {
            lightboxSkeleton.hidden = true;
            lightboxImg.hidden = true;
            lightboxError.hidden = false;
        };
        lightboxImg.src = url;
    }

    function preloadLightboxNeighbors() {
        const imgs = lightboxImages();
        [lightboxIndex - 1, lightboxIndex + 1].forEach(i => {
            if (i >= 0 && i < imgs.length) {
                const pre = new Image();
                pre.src = imgs[i].url;
            }
        });
    }

    function renderLightboxImage() {
        const imgs = lightboxImages();
        const img = imgs[lightboxIndex];
        const single = imgs.length <= 1;
        lightboxPrev.hidden = single;
        lightboxNext.hidden = single;
        lightboxCount.textContent = (lightboxIndex + 1) + ' / ' + imgs.length;
        lightboxCaption.textContent = img.caption ||
            (lightboxFp.name + (lightboxFp.createTime ? ' · ' + formatLightboxDate(lightboxFp.createTime) : ''));
        loadLightboxImage(img.url);
        preloadLightboxNeighbors();
    }

    function openLightbox(fp, index, triggerBtn) {
        lightboxFp = fp;
        lightboxIndex = index;
        lightboxTriggerBtn = triggerBtn || null;
        lightbox.classList.add('show');
        lightbox.setAttribute('aria-hidden', 'false');
        document.getElementById('lightboxClose').focus();
        renderLightboxImage();
    }

    function closeLightbox(returnFocus = true) {
        lightbox.classList.remove('show');
        lightbox.setAttribute('aria-hidden', 'true');
        lightboxImg.onload = null;
        lightboxImg.onerror = null;
        lightboxImg.removeAttribute('src');
        if (returnFocus && lightboxTriggerBtn) {
            lightboxTriggerBtn.focus();   // 焦点还给触发它的图片按钮
        }
        lightboxTriggerBtn = null;
        lightboxFp = null;
    }

    function switchLightbox(delta) {
        const imgs = lightboxImages();
        if (imgs.length < 2) return;
        lightboxIndex = (lightboxIndex + delta + imgs.length) % imgs.length;
        renderLightboxImage();
    }

    lightboxPrev.addEventListener('click', () => switchLightbox(-1));
    lightboxNext.addEventListener('click', () => switchLightbox(1));
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    lightboxRetry.addEventListener('click', () => {
        const imgs = lightboxImages();
        if (imgs[lightboxIndex]) loadLightboxImage(imgs[lightboxIndex].url);
    });
    // 点击灯箱背景（图片之外）关闭
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target === lightboxStage) closeLightbox();
    });
    // 触屏左右滑动切换
    let lightboxTouchX = null;
    lightbox.addEventListener('touchstart', (e) => {
        lightboxTouchX = e.touches[0].clientX;
    }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
        if (lightboxTouchX === null) return;
        const dx = e.changedTouches[0].clientX - lightboxTouchX;
        if (Math.abs(dx) > 40) switchLightbox(dx < 0 ? 1 : -1);
        lightboxTouchX = null;
    }, { passive: true });

    // 在地图上查看：关闭相册与灯箱 → 飞到标记 → 打开详情卡
    lightboxMap.addEventListener('click', (e) => {
        const fp = lightboxFp;
        closeLightbox(false);
        closeAlbum(false);
        if (!fp) return;
        const idx = FOOTPRINTS.indexOf(fp);
        if (idx < 0) return;
        showMarkerCard(fp, idx);
        if (e.detail === 0) document.getElementById('markerCardClose').focus();   // 键盘激活时焦点进入详情卡
        const pos = currentPositions[idx];
        if (pos) {
            const height = fp.zoomLevel
                ? (156543.03392 * Math.cos(Cesium.Math.toRadians(pos.lat))) / Math.pow(2, fp.zoomLevel) * 1000
                : 120000;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, height),
                duration: 2.2
            });
        }
    });

    // ================= 城市足迹全屏视图（左侧足迹 Tab 卡片 + 右侧详情） =================
    const cityView = document.getElementById('cityView');
    const cityViewBack = document.getElementById('cityViewBack');
    const cityViewClose = document.getElementById('cityViewClose');
    const cityViewTitle = document.getElementById('cityViewTitle');
    const cityViewStats = document.getElementById('cityViewStats');
    const cityViewPrevCity = document.getElementById('cityViewPrevCity');
    const cityViewNextCity = document.getElementById('cityViewNextCity');
    const cityTabs = document.getElementById('cityTabs');
    const cityStage = document.getElementById('cityStage');
    let cityViewCityIndex = -1;      // 当前城市（cityList 下标）
    let cityViewTabIndex = 0;        // 当前选中的足迹 Tab
    let cityViewTriggerBtn = null;   // 键盘触发时的返回焦点按钮

    function cityViewFootprints() {
        const city = cityList[cityViewCityIndex];
        return city ? city.indices.map(i => FOOTPRINTS[i]).filter(Boolean) : [];
    }
    function cityWallImages(fp) {
        let gallery = fp && fp.galleryImages;
        if (typeof gallery === 'string') {
            try { gallery = JSON.parse(gallery); } catch (e) { gallery = []; }
        }
        const normalized = Array.isArray(gallery)
            ? gallery.map((item) => typeof item === 'string' ? { url: item, caption: '' } : item).filter(item => item && item.url)
            : [];
        return normalized.length ? normalized : (fp.image ? [{ url: fp.image, caption: '' }] : []);
    }

    function formatCityDate(value) {
        const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (!match) return String(value || '日期未知');
        return match[1] + ' / ' + String(match[2]).padStart(2, '0') + '.' + String(match[3]).padStart(2, '0');
    }

    // 灯箱下方的时间日期：YYYY-MM-DD HH:MM（无时间部分时只显示日期）
    function formatLightboxDate(value) {
        const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
        if (!match) return String(value || '日期未知');
        const date = match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
        return match[4] ? date + ' ' + String(match[4]).padStart(2, '0') + ':' + match[5] : date;
    }

    function renderCityStage(fp, photoLimit = 8, preserveScroll = false) {
        const imgs = cityWallImages(fp);
        const prevScrollTop = preserveScroll ? cityStage.scrollTop : 0;
        const content = document.createElement('div');
        content.className = 'city-stage-content';
        content.style.setProperty('--extra-height', Math.max(0, Math.ceil((imgs.length - 4) / 4)) * 188 + 'px');

        const hero = document.createElement('button');
        hero.type = 'button';
        hero.className = 'city-fp-hero';
        hero.setAttribute('aria-label', fp.name + ' · 查看第 1 张照片');
        if (imgs[0]) hero.style.backgroundImage = 'url("' + imgs[0].url + '")';
        const heroBody = document.createElement('div');
        heroBody.className = 'city-fp-hero-body';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'city-fp-eyebrow';
        eyebrow.textContent = 'Footprint · ' + (fp.footprintType || '旅行');
        const name = document.createElement('h3');
        name.className = 'city-fp-name';
        name.textContent = fp.name;
        const meta = document.createElement('p');
        meta.className = 'city-fp-meta';
        meta.textContent = [fp.city, fp.createTime, fp.address].filter(Boolean).join(' · ');
        heroBody.append(eyebrow, name, meta);
        hero.appendChild(heroBody);
        if (imgs[0]) {
            hero.addEventListener('click', () => openLightbox(fp, 0, hero));
            hero.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openLightbox(fp, 0, hero);
                }
            });
        }
        content.appendChild(hero);

        if (fp.description) {
            const desc = document.createElement('p');
            desc.className = 'city-fp-desc';
            desc.textContent = fp.description;
            content.appendChild(desc);
        }

        const wall = document.createElement('div');
        wall.className = 'city-fp-wall';
        if (imgs.length) {
            imgs.forEach((img, idx) => {
                const tile = document.createElement('button');
                tile.type = 'button';
                tile.className = 'city-wall-tile';
                if (idx >= 4) {
                    const extraIndex = idx - 4;
                    const extraColumn = extraIndex % 4;
                    const extraRow = Math.floor(extraIndex / 4);
                    tile.classList.add('city-wall-tile-extra');
                    tile.style.setProperty('--extra-left', (8 + extraColumn * 23) + '%');
                    tile.style.setProperty('--extra-top', (650 + extraRow * 188) + 'px');
                }
                tile.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
                const photo = document.createElement('img');
                photo.loading = 'lazy';
                photo.src = img.url;
                photo.alt = img.caption || fp.name;
                tile.appendChild(photo);
                tile.addEventListener('click', () => openLightbox(fp, idx, tile));
                wall.appendChild(tile);
            });
            if (imgs.length > 5) {
                const overflowNote = document.createElement('span');
                overflowNote.className = 'city-wall-overflow-note';
                overflowNote.textContent = '共 ' + imgs.length + ' 张照片 · 主图与卡片均可点击放大';
                wall.appendChild(overflowNote);
            }
        } else {
            const empty = document.createElement('div');
            empty.className = 'city-wall-empty';
            empty.textContent = '暂无照片';
            wall.appendChild(empty);
        }
        content.appendChild(wall);

        const mapWall = document.createElement('div');
        mapWall.className = 'city-map-wall';
        const mapCanvas = document.createElement('div');
        mapCanvas.className = 'city-map-canvas';
        const mapRoute = document.createElement('span');
        mapRoute.className = 'city-map-route';
        const mapCore = document.createElement('div');
        mapCore.className = 'city-map-core';
        const mapCoreKicker = document.createElement('span');
        mapCoreKicker.className = 'city-map-core-kicker';
        mapCoreKicker.textContent = 'LOCATION MAP';
        const mapCoreTitle = document.createElement('strong');
        mapCoreTitle.textContent = fp.city || fp.name;
        const mapCoreMeta = document.createElement('small');
        mapCoreMeta.textContent = [fp.lat && fp.lat.toFixed ? fp.lat.toFixed(4) : '', fp.lng && fp.lng.toFixed ? fp.lng.toFixed(4) : ''].filter(Boolean).join('  /  ');
        mapCore.append(mapCoreKicker, mapCoreTitle, mapCoreMeta);
        mapCanvas.append(mapRoute, mapCore);
        const orbitSlots = [
            [4, 10], [25, 4], [61, 4], [83, 10],
            [4, 54], [25, 68], [61, 68], [83, 54]
        ];
        const extraCount = Math.max(0, imgs.length - orbitSlots.length);
        const extraRows = Math.ceil(extraCount / 5);
        mapCanvas.style.height = (900 + extraRows * 190) + 'px';
        imgs.forEach((img, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'city-map-photo';
            const slot = orbitSlots[idx];
            if (slot) {
                card.style.left = slot[0] + '%';
                card.style.top = slot[1] + '%';
            } else {
                const extraIndex = idx - orbitSlots.length;
                card.style.left = (4 + (extraIndex % 5) * 21) + '%';
                card.style.top = (900 + Math.floor(extraIndex / 5) * 190) + 'px';
                card.classList.add('city-map-photo-extra');
            }
            const cardX = slot ? slot[0] : 4 + ((idx - orbitSlots.length) % 5) * 21;
            const cardY = slot ? slot[1] : 900;
            card.style.setProperty('--line-angle', Math.atan2(50 - cardY, 50 - cardX) * 180 / Math.PI + 'deg');
            card.setAttribute('aria-label', fp.name + ' · 地图照片 ' + (idx + 1));
            const connector = document.createElement('span');
            connector.className = 'city-map-connector';
            const pin = document.createElement('span');
            pin.className = 'city-map-pin';
            const photo = document.createElement('img');
            photo.loading = 'lazy';
            photo.src = img.url;
            photo.alt = img.caption || fp.name;
            card.append(connector, pin, photo);
            card.addEventListener('click', () => openLightbox(fp, idx, card));
            mapCanvas.appendChild(card);
        });
        mapWall.appendChild(mapCanvas);
        content.appendChild(mapWall);

        const journal = document.createElement('section');
        journal.className = 'city-journal-wall';
        const journalHead = document.createElement('header');
        journalHead.className = 'city-journal-head';
        const journalKicker = document.createElement('span');
        journalKicker.className = 'city-journal-kicker';
        journalKicker.textContent = 'TRAVEL JOURNAL';
        const journalTitle = document.createElement('h3');
        journalTitle.textContent = fp.name;
        const journalDate = document.createElement('time');
        journalDate.textContent = formatCityDate(fp.createTime);
        const journalCount = document.createElement('span');
        journalCount.className = 'city-journal-count';
        journalCount.textContent = imgs.length + ' 张照片';
        journalHead.append(journalKicker, journalTitle, journalDate, journalCount);
        journal.appendChild(journalHead);

        if (fp.description) {
            const journalDesc = document.createElement('p');
            journalDesc.className = 'city-journal-description';
            journalDesc.textContent = fp.description;
            journal.appendChild(journalDesc);
        }

        const journalGrid = document.createElement('div');
        journalGrid.className = 'city-journal-grid';
        const visibleImages = imgs.slice(0, Math.max(1, photoLimit));
        visibleImages.forEach((img, idx) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'city-journal-card';
            card.classList.add('is-loading');
            card.setAttribute('aria-label', fp.name + ' · 第 ' + (idx + 1) + ' 张');
            const photo = document.createElement('img');
            photo.loading = idx < 4 ? 'eager' : 'lazy';
            photo.src = img.url;
            photo.alt = img.caption || fp.name;
            card.appendChild(photo);
            photo.addEventListener('load', () => {
                card.classList.remove('is-loading', 'is-error');
            });
            photo.addEventListener('error', () => {
                card.classList.remove('is-loading');
                card.classList.add('is-error');
            });
            if (photo.complete) {
                if (photo.naturalWidth > 0) {
                    card.classList.remove('is-loading');
                } else {
                    card.classList.remove('is-loading');
                    card.classList.add('is-error');
                }
            }
            if (img.caption) {
                const caption = document.createElement('span');
                caption.className = 'city-journal-caption';
                caption.textContent = img.caption;
                card.appendChild(caption);
            }
            card.addEventListener('click', () => openLightbox(fp, idx, card));
            journalGrid.appendChild(card);
        });
        if (!imgs.length) {
            const empty = document.createElement('div');
            empty.className = 'city-journal-empty';
            empty.textContent = '暂无照片';
            journalGrid.appendChild(empty);
        }
        journal.appendChild(journalGrid);

        if (imgs.length > visibleImages.length) {
            const loadMore = document.createElement('button');
            loadMore.type = 'button';
            loadMore.className = 'city-journal-more';
            loadMore.textContent = '加载更多照片  ' + visibleImages.length + ' / ' + imgs.length;
            loadMore.addEventListener('click', () => {
                renderCityStage(fp, Math.min(visibleImages.length + 8, imgs.length), true);
            });
            journal.appendChild(loadMore);
        }
        content.appendChild(journal);

        cityStage.innerHTML = '';
        cityStage.appendChild(content);
        cityStage.scrollTop = preserveScroll ? prevScrollTop : 0;
        if (preserveScroll) {
            const nextMore = cityStage.querySelector('.city-journal-more');
            if (nextMore) nextMore.focus({ preventScroll: true });
        }
    }

    function selectCityViewTab(i) {
        const fps = cityViewFootprints();
        if (!fps.length) return;
        cityViewTabIndex = Math.max(0, Math.min(i, fps.length - 1));
        [...cityTabs.querySelectorAll('.city-tab')].forEach((t, k) => {
            const active = k === cityViewTabIndex;
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', String(active));
        });
        renderCityStage(fps[cityViewTabIndex]);
    }

    function renderCityView() {
        const fps = cityViewFootprints();
        cityTabs.innerHTML = '';
        cityStage.innerHTML = '';
        if (!fps.length) return;
        const city = cityList[cityViewCityIndex];
        const photoCount = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
        cityViewTitle.textContent = city.city;
        cityViewStats.textContent = fps.length + ' 个足迹 · ' + photoCount + ' 张照片';

        fps.forEach((fp, i) => {
            const imgs = cityWallImages(fp);
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'city-tab';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('aria-label', fp.name + '，' + (imgs.length || 0) + ' 张照片');
            const order = document.createElement('span');
            order.className = 'city-tab-index';
            order.textContent = String(i + 1).padStart(2, '0');
            const thumbWrap = document.createElement('span');
            thumbWrap.className = 'city-tab-thumb';
            if (imgs[0]) {
                thumbWrap.classList.add('is-loading');
                const th = document.createElement('img');
                th.loading = 'lazy';
                th.src = imgs[0].url;
                th.alt = '';
                thumbWrap.appendChild(th);
                th.addEventListener('load', () => {
                    thumbWrap.classList.remove('is-loading', 'is-error');
                });
                th.addEventListener('error', () => {
                    thumbWrap.classList.remove('is-loading');
                    thumbWrap.classList.add('is-error');
                });
                if (th.complete) {
                    if (th.naturalWidth > 0) {
                        thumbWrap.classList.remove('is-loading');
                    } else {
                        thumbWrap.classList.remove('is-loading');
                        thumbWrap.classList.add('is-error');
                    }
                }
            } else {
                thumbWrap.classList.add('is-empty');
            }
            const info = document.createElement('span');
            info.className = 'city-tab-info';
            const tName = document.createElement('span');
            tName.className = 'city-tab-name';
            tName.textContent = fp.name;
            const tMeta = document.createElement('span');
            tMeta.className = 'city-tab-meta';
            const tDate = document.createElement('span');
            tDate.className = 'city-tab-date';
            tDate.textContent = formatCityDate(fp.createTime);
            const tPhotos = document.createElement('span');
            tPhotos.className = 'city-tab-photos';
            tPhotos.textContent = imgs.length ? imgs.length + ' 张照片' : '暂无照片';
            tMeta.append(tDate, tPhotos);
            info.append(tName, tMeta);
            tab.append(order, thumbWrap, info);
            tab.addEventListener('click', () => selectCityViewTab(i));
            cityTabs.appendChild(tab);
        });
        cityViewTabIndex = Math.min(cityViewTabIndex, fps.length - 1);
        selectCityViewTab(cityViewTabIndex);
    }

    function switchCityViewCity(delta) {
        if (cityList.length < 2) return;
        cityViewCityIndex = (cityViewCityIndex + delta + cityList.length) % cityList.length;
        cityViewTabIndex = 0;
        renderCityView();
    }

    // 关闭全屏视图，飞到该足迹在地球上的位置（不打开详情卡）
    function flyToCityFootprint(fp) {
        const idx = FOOTPRINTS.indexOf(fp);
        closeCityView(false);
        if (idx < 0) return;
        const pos = currentPositions[idx];
        if (pos) {
            const height = fp.zoomLevel
                ? (156543.03392 * Math.cos(Cesium.Math.toRadians(pos.lat))) / Math.pow(2, fp.zoomLevel) * 1000
                : 120000;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, height),
                duration: 2.2
            });
        }
    }

    function openCityView(ci, triggerBtn) {
        if (!cityList[ci]) return;
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (albumOverlay.classList.contains('show')) closeAlbum(false);
        hideMarkerTip();
        cityViewCityIndex = ci;
        cityViewTabIndex = 0;
        cityViewTriggerBtn = triggerBtn || null;
        renderCityView();
        cityView.classList.add('show');
        cityView.setAttribute('aria-hidden', 'false');
        cityViewClose.focus();
    }

    function closeCityView(returnFocus = true) {
        if (lightbox.classList.contains('show')) closeLightbox(false);
        cityView.classList.remove('show');
        cityView.setAttribute('aria-hidden', 'true');
        if (returnFocus && cityViewTriggerBtn) {
            cityViewTriggerBtn.focus();
            cityViewTriggerBtn = null;
        }
    }

    cityViewBack.addEventListener('click', () => closeCityView());
    cityViewClose.addEventListener('click', () => closeCityView());
    cityViewPrevCity.addEventListener('click', () => switchCityViewCity(-1));
    cityViewNextCity.addEventListener('click', () => switchCityViewCity(1));
    cityView.addEventListener('click', (e) => {
        if (e.target === cityView) closeCityView();
    });
    // Tab 列表内用 ↑ / ↓ 切换足迹
    cityTabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const fps = cityViewFootprints();
        if (fps.length < 2) return;
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        selectCityViewTab((cityViewTabIndex + d + fps.length) % fps.length);
        const tabs = [...cityTabs.querySelectorAll('.city-tab')];
        if (tabs[cityViewTabIndex]) tabs[cityViewTabIndex].focus();
    });
    // ================= 加载足迹数据并重建标记 =================
    loadFootprintsFromJson().then(loaded => {
        if (applyFootprints(loaded)) {
            markerEntities.forEach(ent => viewer.entities.remove(ent));
            // 按当前底图坐标系重算标记坐标，并刷新状态栏足迹数（不重载瓦片，避免闪烁）
            if (currentBaseKey) {
                applyMarkerPositions(currentBaseKey);
                updateStatusText();
            }
            buildMarkers();
            buildCityMarkers();
            // 按当前视角恢复城市/展开模式（整球视图默认城市聚合）
            const h = viewer.camera.positionCartographic.height;
            applyMarkerMode(h > CITY_COLLAPSE_HEIGHT);
            if (cityFillEnabled) buildCityFills();   // 城市高亮开关开启时才随新数据重建
        }
        updateIntroStats();
        document.dispatchEvent(new CustomEvent('footprints:loaded'));
    });

    // ================= 中国轮廓 GeoJSON =================
    // 使用阿里云 DataV 提供的公开中国边界数据（国内可访问）。
    // 该数据默认是 GCJ-02，与高德底图对齐；切到天地图（WGS84）时会有约 500 米偏移，
    // 国家尺度下基本不可见（城市级填充已做坐标转换，见 buildCityFills）。

    // ================= 城市淡色填充 =================
    // 给去过的城市罩一层淡色（城市级边界，clampToGround 贴合地形）。
    // 注意：clampToGround 的多边形不渲染 outline（GeoJSON 的 stroke/strokeWidth 会静默失效），
    // 所以边界轮廓单独提取环线，用贴合地面的折线绘制。
    // DataV 边界是 GCJ-02：高德底图直接使用；切到天地图（WGS84）底图时整体转换坐标与标记对齐。

    function loadCityBoundary(adcode) {
        if (!cityBoundaryCache.has(adcode)) {
            cityBoundaryCache.set(
                adcode,
                // DataV 服务带防盗链：请求携带站点 Referer（如 lik.cc）会返回 403，
                // 这里显式关闭 Referer（no-referrer），与无 Referer 的 curl 结果一致（200）。
                fetch('https://geo.datav.aliyun.com/areas_v3/bound/' + adcode + '.json', {
                    referrerPolicy: 'no-referrer'
                })
                    .then(res => {
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return res.json();
                    })
                    .catch(e => {
                        cityBoundaryCache.delete(adcode);   // 失败允许下次重试
                        throw e;
                    })
            );
        }
        return cityBoundaryCache.get(adcode);
    }

    // 把 DataV 的 GCJ-02 边界整体转成 WGS84（天地图底图时调用）
    function cityBoundaryToWgs84(geojson) {
        const clone = typeof structuredClone === 'function'
            ? structuredClone(geojson)
            : JSON.parse(JSON.stringify(geojson));
        const convert = coords => {
            if (typeof coords[0] === 'number') {
                const w = gcj02ToWgs84(coords[0], coords[1]);
                return [w.lng, w.lat];
            }
            return coords.map(convert);
        };
        (clone.features || []).forEach(f => {
            if (f.geometry && f.geometry.coordinates) {
                f.geometry.coordinates = convert(f.geometry.coordinates);
            }
        });
        return clone;
    }

    function clearCityFills() {
        cityFillDataSources.forEach(ds => viewer.dataSources.remove(ds));
        cityFillDataSources = [];
        cityOutlinePolylines = [];
    }

    function buildCityFills() {
        const buildId = ++cityFillBuildId;   // 防止上次异步加载残留
        clearCityFills();
        const fillColor = CITY_FILL_THEMES[CITY_FILL_THEME] || CITY_FILL_THEMES.amber;
        const item = currentBaseKey ? baseProviders[currentBaseKey] : null;
        const basemapIsGcj = !!(item && item.gcj);
        const seen = new Set();
        FOOTPRINTS.forEach(fp => {
            const adcode = String(fp.cityAdcode || '');
            if (!adcode || seen.has(adcode)) return;
            seen.add(adcode);
            loadCityBoundary(adcode).then(geojson => {
                if (buildId !== cityFillBuildId) return null;   // 已被更新的构建取代
                const data = basemapIsGcj ? geojson : cityBoundaryToWgs84(geojson);
                return Cesium.GeoJsonDataSource.load(data, {
                    clampToGround: true,   // 贴合地形，避免被地形盖住
                    fill: Cesium.Color.fromCssColorString(fillColor.fill),
                    stroke: Cesium.Color.WHITE.withAlpha(0.4),
                    strokeWidth: 1
                });
            }).then(ds => {
                if (!ds) return;
                if (buildId !== cityFillBuildId) {   // 已被更新的构建取代
                    viewer.dataSources.remove(ds);
                    return;
                }
                ds.show = false;   // 默认隐藏，放大到国内范围后显示
                viewer.dataSources.add(ds);

                // 边界轮廓：从多边形层级中提取外环与孔洞环，闭合后画成贴合地面的折线
                const now = Cesium.JulianDate.now();
                ds.entities.values.forEach(entity => {
                    const polygon = entity.polygon;
                    if (!polygon || !polygon.hierarchy) return;
                    const hierarchy = polygon.hierarchy.getValue(now);
                    if (!hierarchy || !hierarchy.positions || !hierarchy.positions.length) return;
                    const rings = [hierarchy.positions];
                    (hierarchy.holes || []).forEach(hole => {
                        if (hole && hole.positions && hole.positions.length) rings.push(hole.positions);
                    });
                    rings.forEach(ring => {
                        const closed = ring.slice();
                        closed.push(closed[0]);   // 闭合环线
                        const outlineEnt = ds.entities.add({
                            polyline: {
                                positions: closed,
                                clampToGround: true,   // 贴合地形
                                width: 1,
                                material: Cesium.Color.WHITE.withAlpha(0.4)
                            }
                        });
                        cityOutlinePolylines.push(outlineEnt.polyline);
                    });
                });

                cityFillDataSources.push(ds);
            }).catch(e => {
                console.warn('城市边界加载失败 ' + adcode + ':', e);
            });
        });
    }

    // ================= 票根墙 =================
    // 票根是独立于足迹封面和图片墙的单图资源：一条足迹最多对应一张票根。
    const ticketGallery = document.getElementById('ticketGallery');
    const ticketGalleryBtn = document.getElementById('ticketGalleryBtn');
    const ticketGalleryBack = document.getElementById('ticketGalleryBack');
    const ticketGalleryClose = document.getElementById('ticketGalleryClose');
    const ticketGalleryEmpty = document.getElementById('ticketGalleryEmpty');
    const ticketGalleryStats = document.getElementById('ticketGalleryStats');
    const ticketGalleryCount = document.getElementById('ticketGalleryCount');
    const ticketLightbox = ticketGallery;
    const ticketWallet = document.getElementById('ticketWallet');
    const ticketGalleryHint = document.getElementById('ticketGalleryHint');
    const ticketLightboxLoading = document.getElementById('ticketGalleryLoading');
    const ticketLightboxError = document.getElementById('ticketGalleryError');
    const ticketLightboxTitle = document.getElementById('ticketGalleryTitle');
    const ticketLightboxSubtitle = document.getElementById('ticketGallerySubtitle');
    const ticketLightboxDetails = document.getElementById('ticketGalleryDetails');
    const ticketLightboxDescription = document.getElementById('ticketGalleryDescription');
    const ticketLightboxCount = document.getElementById('ticketGalleryPosition');
    const ticketLightboxRetry = document.getElementById('ticketGalleryRetry');
    let ticketItems = [];
    let ticketIndex = 0;
    let ticketTrigger = null;
    let walletItems = [];      // 票夹中的票根元素 [{ fp, img }]
    let wheelLocked = false;   // 滚轮切换节流
    let walletTouchX = null;   // 触摸滑动起点

    function ticketEscape(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function ticketImageUrl(value) {
        // Halo 附件字段在不同版本/配置下可能返回 URL 字符串、对象或单元素数组。
        if (Array.isArray(value)) value = value.find(item => ticketImageUrl(item)) || '';
        if (value && typeof value === 'object') {
            value = value.url || value.src || value.thumbnail || value.path || value.spec?.url || '';
        }
        const url = String(value || '').trim();
        if (/^https?:\/\//i.test(url)) return url;
        if (/^\/\//.test(url)) return window.location.protocol + url;
        if (/^\//.test(url)) return url;
        return '';
    }

    function ticketDate(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        return match ? match[1] + '.' + match[2] + '.' + match[3] : raw;
    }

    function ticketItemsFromFootprints() {
        return FOOTPRINTS.filter(fp => ticketImageUrl(fp.ticketImage));
    }

    function ticketMeta(fp) {
        return {
            title: fp.ticketTitle || fp.name || '未命名足迹',
            subtitle: fp.ticketSubtitle || fp.city || fp.province || '',
            date: ticketDate(fp.ticketDate || fp.createTime),
            route: fp.ticketRoute || fp.address || '',
            no: fp.ticketNo || '',
            type: fp.ticketType || fp.footprintType || '',
            description: fp.description || ''
        };
    }

    // 票根页只通过导航栏“票根”按钮进入，不写 URL、不响应 ?view=tickets，
    // 避免刷新/直接访问该路径时以残缺状态加载票根页。
    function setTicketView(open) {
        if (!ticketGallery) return;
        if (open) {
            ticketItems = ticketItemsFromFootprints();
            ticketGalleryEmpty.hidden = ticketItems.length > 0;
            ticketGalleryCount.textContent = ticketItems.length ? ticketItems.length + ' 张票根' : '';
            const cities = new Set(ticketItems.map(fp => fp.city).filter(Boolean));
            const latest = ticketItems.map(fp => ticketDate(fp.ticketDate || fp.createTime)).filter(Boolean)[0] || '';
            ticketGalleryStats.textContent = ticketItems.length
                ? ticketItems.length + ' 张票根 · ' + (cities.size || '多个') + ' 个目的地' + (latest ? ' · 最近 ' + latest : '')
                : '收集每一次出发的凭证';
            ticketGallery.classList.add('show');
            ticketGallery.setAttribute('aria-hidden', 'false');
            document.body.classList.add('ticket-gallery-open');
            // 打开票根页：地球作为背景，若未开启自转则自动开启
            if (!autoRotate) setAutoRotate(true);
            if (ticketItems.length) {
                ticketIndex = 0;
                buildTicketWallet();
                renderTicketWallet();
                ticketGalleryClose.focus();
            } else {
                ticketGalleryClose.focus();
            }
        } else {
            ticketGallery.classList.remove('show');
            ticketGallery.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('ticket-gallery-open');
            if (ticketTrigger) ticketTrigger.focus();
        }
    }

    // 票夹：把每张票根叠成一层，第一张完整展示，后面的从边缘露出一条边。
    function buildTicketWallet() {
        ticketWallet.innerHTML = '';
        walletItems = ticketItems.map((fp, i) => {
            const img = document.createElement('img');
            img.className = 'ticket-wallet-item';
            img.alt = fp.ticketTitle || fp.name || '';
            img.referrerPolicy = 'no-referrer';
            img.decoding = 'async';
            img.dataset.index = String(i);
            const originalUrl = ticketImageUrl(fp.ticketImage);
            let triedHttps = false;
            img.onload = () => {
                img.classList.add('is-loaded');
                if (i === ticketIndex) {
                    ticketLightboxLoading.hidden = true;
                    ticketLightboxError.hidden = true;
                }
            };
            img.onerror = () => {
                // HTTPS 页面会拦截 HTTP 图片；同一域名通常可直接升级为 HTTPS。
                if (!triedHttps && window.location.protocol === 'https:' && /^http:\/\//i.test(originalUrl)) {
                    triedHttps = true;
                    img.src = originalUrl.replace(/^http:\/\//i, 'https://');
                    return;
                }
                img.classList.add('is-error');
                if (i === ticketIndex) {
                    ticketLightboxLoading.hidden = true;
                    ticketLightboxError.hidden = false;
                }
            };
            img.src = originalUrl;
            ticketWallet.appendChild(img);
            return { fp, img };
        });
        ticketGalleryHint.hidden = ticketItems.length < 2;
    }

    function renderTicketWallet() {
        const fp = ticketItems[ticketIndex];
        if (!fp) return;
        const meta = ticketMeta(fp);
        ticketLightboxTitle.textContent = meta.title;
        ticketLightboxSubtitle.textContent = meta.subtitle;
        ticketLightboxSubtitle.hidden = !meta.subtitle;
        ticketLightboxDescription.textContent = meta.description;
        ticketLightboxDescription.hidden = !meta.description;
        ticketLightboxDetails.innerHTML = [
            ['日期', meta.date], ['目的地', meta.route], ['类型', meta.type], ['票号', meta.no]
        ].filter(item => item[1]).map(item => '<div><dt>' + ticketEscape(item[0]) + '</dt><dd>' + ticketEscape(item[1]) + '</dd></div>').join('');
        ticketLightboxCount.textContent = (ticketIndex + 1) + ' / ' + ticketItems.length;

        walletItems.forEach((item, i) => {
            const img = item.img;
            const active = i === ticketIndex;
            img.classList.toggle('is-active', active);
            img.classList.toggle('is-behind', !active);
            img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
            if (active) {
                img.style.transform = '';
                img.style.zIndex = '10';
                img.tabIndex = -1;
                // 未加载完成且未失败时显示加载提示；加载完或失败后隐藏
                ticketLightboxLoading.hidden = img.classList.contains('is-loaded') || img.classList.contains('is-error');
                ticketLightboxError.hidden = !img.classList.contains('is-error');
            } else {
                const distance = Math.abs(i - ticketIndex);
                const k = Math.min(distance, 5);
                const dir = i < ticketIndex ? -1 : 1;
                img.style.transform = 'translate(' + (dir * (6 + k * 3)) + 'px, 0) rotate(' + (dir * (0.6 + k * 1.1)) + 'deg)';
                img.style.zIndex = String(10 - distance);
                img.tabIndex = 0;
            }
        });
    }

    function openTicketLightbox(index, trigger) {
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = Math.max(0, Math.min(index, ticketItems.length - 1));
        ticketTrigger = trigger || null;
        buildTicketWallet();
        renderTicketWallet();
        ticketGalleryClose.focus();
    }

    function closeTicketLightbox(returnFocus = true) {
        if (!ticketLightbox) return;
        walletItems.forEach(item => item.img.removeAttribute('src'));
        walletItems = [];
        setTicketView(false);
        if (returnFocus && ticketTrigger) ticketTrigger.focus();
        ticketTrigger = null;
    }

    function switchTicket(delta) {
        if (ticketItems.length < 2) return;
        ticketIndex = (ticketIndex + delta + ticketItems.length) % ticketItems.length;
        renderTicketWallet();
    }

    function reloadTicket(index) {
        const item = walletItems[index];
        if (!item) return;
        const img = item.img;
        img.classList.remove('is-loaded', 'is-error');
        if (index === ticketIndex) {
            ticketLightboxLoading.hidden = false;
            ticketLightboxError.hidden = true;
        }
        img.src = ticketImageUrl(item.fp.ticketImage);
    }

    ticketGalleryBtn.addEventListener('click', () => setTicketView(true));
    ticketGalleryBack.addEventListener('click', () => setTicketView(false));
    ticketGalleryClose.addEventListener('click', () => setTicketView(false));
    ticketLightboxRetry.addEventListener('click', () => reloadTicket(ticketIndex));
    // 点露出的边缘 → 翻到前面；点当前票根 → 转到下一张
    ticketWallet.addEventListener('click', event => {
        const img = event.target.closest('.ticket-wallet-item');
        if (!img) return;
        const index = Number(img.dataset.index);
        if (index === ticketIndex) {
            switchTicket(1);
        } else {
            ticketIndex = index;
            renderTicketWallet();
        }
    });
    // 鼠标滚轮切换
    ticketWallet.addEventListener('wheel', event => {
        if (ticketItems.length < 2 || wheelLocked) return;
        event.preventDefault();
        wheelLocked = true;
        switchTicket(event.deltaY > 0 ? 1 : -1);
        setTimeout(() => { wheelLocked = false; }, 320);
    }, { passive: false });
    // 触摸滑动切换
    ticketWallet.addEventListener('touchstart', event => {
        walletTouchX = event.touches[0].clientX;
    }, { passive: true });
    ticketWallet.addEventListener('touchend', event => {
        if (walletTouchX === null) return;
        const dx = event.changedTouches[0].clientX - walletTouchX;
        if (Math.abs(dx) > 40) switchTicket(dx < 0 ? 1 : -1);
        walletTouchX = null;
    }, { passive: true });
    ticketLightbox.addEventListener('click', event => {
        if (event.target === ticketLightbox) closeTicketLightbox();
    });
    document.addEventListener('keydown', event => {
        if (ticketLightbox.classList.contains('show')) {
            if (event.key === 'ArrowLeft') { event.preventDefault(); switchTicket(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); switchTicket(1); }
            if (event.key === 'Escape') { event.preventDefault(); closeTicketLightbox(); }
            return;
        }
        if (ticketGallery.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            setTicketView(false);
        }
    });
    document.addEventListener('footprints:loaded', () => {
        if (ticketGallery.classList.contains('show')) {
            ticketItems = ticketItemsFromFootprints();
            ticketIndex = 0;
            buildTicketWallet();
            renderTicketWallet();
        }
    });

    const chinaDataSource = Cesium.GeoJsonDataSource.load(
        '/plugins/footprint/assets/static/data/china-full.json',
        {
            stroke: Cesium.Color.WHITE,          // 边界线颜色
            fill: Cesium.Color.PALETURQUOISE.withAlpha(0), // 填充颜色（设为透明）
            strokeWidth: 0.5                      // 边界线宽度
        }
    );

    chinaDataSource.then(dataSource => {
        chinaBoundarySource = dataSource;
        dataSource.show = false;   // 默认隐藏，放大到国内范围后由 updateIntroVisibility 显示
        viewer.dataSources.add(dataSource);

        // 由于 Cesium 的 strokeWidth 在复杂边界上可能渲染不佳，
        // 为每个多边形单独绘制一条折线来精确控制边界样式
        const entities = dataSource.entities.values;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            if (entity.polygon) {
                entity.polyline = {
                    positions: entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions,
                    width: 0.5,
                    material: Cesium.Color.WHITE
                };
            }
        }
    }).catch(error => {
        console.error('加载中国轮廓数据失败:', error);
    });

    // 初始构建城市淡色填充（足迹数据加载完成后会重建）
    if (cityFillEnabled) buildCityFills();

    // ================= 恢复上次视图状态 =================
    // 刷新后保持上次的 2D/3D 模式（直接恢复，不做展开动画，避免 3D 闪一下）
    try {
        if (getSavedViewMode() === '2d' && !amapMode) {
            finishSwitchTo2D();
        }
    } catch (e) {
        console.warn('恢复视图状态失败，使用默认 3D 视图：', e);
        saveViewMode('3d');
        document.body.classList.remove('mode-2d');
        document.body.classList.add('mode-3d');
        if (view3d) view3d.hidden = false;
        if (view2d) view2d.hidden = true;
    }
