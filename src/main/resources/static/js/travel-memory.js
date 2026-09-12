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
    const WHEEL_ZOOM_FACTOR = 3.5;   // 滚轮灵敏度系数（默认 5，越小滚一格缩放越精细）
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
    const navTools = document.getElementById('navTools');
    const navMoreBtn = document.getElementById('navMoreBtn');
    const navBackGlobeBtn = document.getElementById('navBackGlobeBtn');
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
    const CITY_VIEW_HEIGHT = 1200000;      // 点击城市后的落地高度：低于展开阈值，保持城市整体视野
    let cityMode = true;
    // 程序化“飞往城市”的飞行状态：飞行期间抑制高度阈值自动切换，
    // 落地后再统一把聚合标记展开为该城市的足迹点，避免用户手动补一次缩放。
    let cityFlightActive = false;
    let cityFlightIndex = -1;
    let cityFlightTimer = null;
    let cityMoveEndHandler = null;
    let cityRevealRaf = null;
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
            document.body.classList.remove('nav-zoom');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 全屏覆盖层（城市卡片墙 / 城市足迹 / 票根）打开时隐藏顶部导航栏与标题卡，避免遮挡；
        // 这里用 getElementById 动态判断，避免引用后置声明的变量（TDZ）。
        const cityViewEl = document.getElementById('cityView');
        const cityWallEl = document.getElementById('cityWall');
        const ticketGalleryEl = document.getElementById('ticketGallery');
        const overlayOpen = !!(cityViewEl && cityViewEl.classList.contains('show')) ||
            !!(cityWallEl && cityWallEl.classList.contains('show')) ||
            !!(ticketGalleryEl && ticketGalleryEl.classList.contains('show'));
        if (overlayOpen) {
            if (introVisible) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            topNav.classList.remove('visible');
            document.body.classList.remove('nav-zoom');
            navTools.classList.remove('open');
            topNav.classList.remove('tools-open');
            navMoreBtn.setAttribute('aria-expanded', 'false');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
            return;
        }
        // 2D 高德视图：导航栏常驻（保证 2D/3D 切换按钮可用），地球标题卡/浮动按钮隐藏
        if (amapMode) {
            pageIntro.classList.remove('visible');
            topNav.classList.add('visible');
            document.body.classList.remove('nav-zoom');
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
            document.body.classList.remove('nav-zoom');
            backGlobeBtn.classList.remove('show');
            cityFillFloatBtn.classList.remove('show');
        } else {
            const h = viewer.camera.positionCartographic.height;
            if (!introVisible && h > INTRO_SHOW_HEIGHT) {
                introVisible = true;
                pageIntro.classList.add('visible');
                // 回到整球视图时复位“工具”溢出菜单，避免残留展开态
                navTools.classList.remove('open');
                topNav.classList.remove('tools-open');
                navMoreBtn.setAttribute('aria-expanded', 'false');
                if (markerCardReady && markerCard.classList.contains('visible')) {
                    hideMarkerCard();   // 回到整球视图时自动关闭详情卡
                }
            } else if (introVisible && h < INTRO_HIDE_HEIGHT) {
                introVisible = false;
                pageIntro.classList.remove('visible');
            }
            // 导航常驻：整球视图显示全部工具；放大后保留 2D/票根/回到整球等入口。
            // 每次渲染都按当前相机高度校正状态，覆盖层关闭后也能自动恢复。
            topNav.classList.add('visible');
            document.body.classList.toggle('nav-zoom', !introVisible);
            // 浮动快捷按钮只作为非导航场景的补充；nav-zoom 时由 CSS 隐藏
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

        // 城市聚合切换：放大到城市范围展开为单个足迹，拉远聚合回城市标记。
        // 程序化“飞往城市”期间先不按高度切换，落地瞬间由 finishCityFlight 统一展开。
        if (!cityFlightActive) {
            const modeH = viewer.camera.positionCartographic.height;
            if (cityMode && modeH < CITY_EXPAND_HEIGHT) {
                applyMarkerMode(false);
            } else if (!cityMode && modeH > CITY_COLLAPSE_HEIGHT) {
                applyMarkerMode(true);
            }
        }
    }
    viewer.scene.postRender.addEventListener(updateIntroVisibility);
    updateIntroVisibility();

    // 回到整球视图：飞回初始中国朝向的整球视角
    function flyBackToGlobe() {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            duration: 1.8
        });
    }
    backGlobeBtn.addEventListener('click', flyBackToGlobe);
    if (navBackGlobeBtn) navBackGlobeBtn.addEventListener('click', flyBackToGlobe);

    // 票根页（重走放映）会把镜头停在某个城市附近，
    // 这个高度下自动旋转看起来像原地打转；返回地球/回到票夹时若自动旋转开着，
    // 就把视角收回整个地球。只在确实被拉近（低于整球高度）时触发，避免多余飞行。
    function restoreGlobeViewForAutoRotate() {
        if (!autoRotate) return;
        if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
        if (viewer.camera.positionCartographic.height >= INTRO_SHOW_HEIGHT) return;
        viewer.camera.cancelFlight();
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
            duration: reduceMotion ? 0 : 1.8
        });
    }

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
        // 按钮显示“将要切换到的视图”，避免“当前状态”造成语义歧义
        const to2D = viewer.scene.mode !== Cesium.SceneMode.SCENE2D;
        sceneModeBtn.textContent = to2D ? '2D 地图' : '3D 地球';
        sceneModeBtn.title = to2D ? '切换到 2D 平面地图' : '切换到 3D 地球';
    }

    // 切换前收起地球侧可能打开的覆盖层，避免返回 3D 时残留
    function closeGlobeOverlays() {
        ['markerCard', 'lightbox', 'cityView', 'markerTip'].forEach(id => {
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
        sceneModeBtn.textContent = '3D 地球';
        sceneModeBtn.title = '切换到 3D 地球';
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
        sceneModeBtn.textContent = '2D 地图';
        sceneModeBtn.title = '切换到 2D 平面地图';
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
        rotateBtn.textContent = '自动旋转';   // 标签固定，状态用高亮表达，避免按钮宽度跳动
        rotateBtn.title = on ? '暂停自动旋转' : '开启自动旋转';
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

    // 足迹标记数据：完全由后端注入的 FOOTPRINT_CONFIG.footprints 提供，不内置任何兜底样例；
    // 没有数据时保持空数组，页面不构建任何标记。
    // coordType: 'gcj02' 表示坐标来自高德（火星坐标），'wgs84' 表示标准经纬度（天地图 CGCS2000 直接可用）
    let FOOTPRINTS = [];
    let footprintsDataReady = false;   // 首次足迹数据加载是否已完成（含“确实为空”）

    // ================= 足迹数据加载（FOOTPRINT_CONFIG） =================
    // window.FOOTPRINT_CONFIG.footprints 为 Footprint CRD 数组（模板注入），坐标均为高德（GCJ-02）来源。
    // 加载失败时回退到上面的内置数据。
    function mapTestJsonEntry(entry) {
        const s = entry && entry.spec;
        if (!s || !s.name) return null;
        return {
            key: (entry.metadata && entry.metadata.name) || '',
            name: s.name,
            description: s.description || '',
            address: s.address || '',
            lng: Number(s.longitude),
            lat: Number(s.latitude),
            coordType: 'gcj02',   // test.json 坐标均为高德（GCJ-02）来源
            city: s.city || '',
            province: s.province || '',
            provinceAdcode: String(s.provinceAdcode || ''),
            cityAdcode: String(s.cityAdcode || ''),
            footprintType: s.footprintType || '',
            createTime: formatTestDate(s.createTime),
            article: s.article || '',
            zoomLevel: Number(s.zoomLevel) || 12,
            image: s.image || '',
            ticketImage: s.ticketImage || '',
            ticketTitle: s.ticketTitle || '',
            ticketEnglish: s.ticketEnglish || '',
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

    // 足迹数据源：只读取模板注入的 window.FOOTPRINT_CONFIG.footprints；
    // 配置为空/无效时返回空数组，页面保持无足迹状态，不再回退样例数据。
    async function loadFootprintsFromJson() {
        try {
            const cfg = window.FOOTPRINT_CONFIG || {};
            const list = Array.isArray(cfg.footprints) ? cfg.footprints : [];
            const mapped = list.map(mapTestJsonEntry).filter(Boolean);
            return mapped;
        } catch (e) {
            console.warn('足迹配置解析失败：', e);
            return [];
        }
    }

    // 用加载到的数据替换足迹数组（保持数组引用不变，各处引用自动生效）
    function applyFootprints(loaded) {
        if (!Array.isArray(loaded)) return false;
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

    // “工具”溢出菜单（紧凑模式/窄屏）：主入口常驻，探索类工具收进菜单
    function setNavToolsOpen(open) {
        navTools.classList.toggle('open', open);
        topNav.classList.toggle('tools-open', open);
        navMoreBtn.setAttribute('aria-expanded', String(open));
        if (!open && !layerPanel.hidden) {
            layerPanel.hidden = true;
            layerMenuBtn.setAttribute('aria-expanded', 'false');
            layerMenu.classList.remove('open');
        }
    }
    navMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setNavToolsOpen(!navTools.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
        if (navTools.classList.contains('open') && !navTools.contains(e.target) && !navMoreBtn.contains(e.target)) {
            setNavToolsOpen(false);
        }
    });
    // 从窄屏切回桌面时复位“工具”弹出态，避免残留的下拉样式
    const navMobileMql = window.matchMedia('(max-width: 820px)');
    function syncNavToolsState() {
        if (!navMobileMql.matches) {
            navTools.classList.remove('open');
            topNav.classList.remove('tools-open');
            navMoreBtn.setAttribute('aria-expanded', 'false');
        }
    }
    if (navMobileMql.addEventListener) {
        navMobileMql.addEventListener('change', syncNavToolsState);
    } else {
        navMobileMql.addListener(syncNavToolsState);
    }

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
        if (navTools.classList.contains('open')) {
            setNavToolsOpen(false);
            return;
        }
        if (lightbox.classList.contains('show')) {
            closeLightbox();
            return;
        }
        if (postcardPreview.classList.contains('show')) {
            closePostcard();
            return;
        }
        if (timeCapsule.classList.contains('show')) {
            closeTimeCapsule();
            return;
        }
        if (insightView.classList.contains('show')) {
            closeInsight();
            return;
        }
        if (cityView.classList.contains('show')) {
            closeCityView();
            return;
        }
        if (cityWall.classList.contains('show')) {
            closeCityWall();
            return;
        }
        if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
            return;
        }
        if (cityCard && cityCard.classList.contains('visible')) {
            hideCityCard();
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
    const terrainAvailable = !!(hasTDTKey && typeof TdtPlug !== 'undefined' && TdtPlug.GeoTerrainProvider);
    terrainBtn.hidden = !terrainAvailable;   // 无 Key / 无插件时直接隐藏，不占导航位置
    if (!terrainAvailable) {
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
    const ENTRANCE_SEEN_KEY = 'footprint-entrance-seen-v1';
    function entranceSeen() {
        try { return localStorage.getItem(ENTRANCE_SEEN_KEY) === '1'; } catch (_) { return false; }
    }
    function markEntranceSeen() {
        try { localStorage.setItem(ENTRANCE_SEEN_KEY, '1'); } catch (_) { /* 隐私模式忽略 */ }
    }

    function globeFirstPaintReady() {
        const globe = viewer.scene && viewer.scene.globe;
        return !!globe && globe.tilesLoaded === true;
    }

    // 等首屏底图瓦片加载完成再播入场动画；网络慢时最多等固定时长，
    // 超时后仍继续播放，避免页面一直停留在等待状态。
    function scheduleEntranceAnimation() {
        const settleAtChina = () => {
            markEntranceSeen();
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000)
            });
        };

        // 已看过一次入场（首次进入/历史访问）：刷新后直接停在中国整球视图，
        // 不再跨太平洋重播动画，也不自动开启旋转，减少重复加载带来的卡顿。
        if (entranceSeen()) {
            settleAtChina();
            return;
        }

        const DATA_TIMEOUT_MS = 4000;
        const TILE_TIMEOUT_MS = 3500;
        const startAt = performance.now();
        // 先把相机放在入场动画的起点（太平洋方向），让这一段底图优先开始加载，
        // 避免“动画开始后才现加载瓦片”导致空转。
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(-60, 30, 25000000)
        });

        function step(now) {
            const elapsed = now - startAt;
            // 足迹数据还没就绪：等数据回来（可能是“空数据”），避免对空地球播入场
            if (!footprintsDataReady) {
                if (elapsed < DATA_TIMEOUT_MS) {
                    requestAnimationFrame(step);
                    return;
                }
                settleAtChina();
                return;
            }
            // 没有足迹数据：不播入场，直接停在中国整球视图
            if (!FOOTPRINTS.length) {
                settleAtChina();
                return;
            }
            // 首屏瓦片就绪才开始动画；等待超时则直接停在中国，避免在空白上硬播
            if (globeFirstPaintReady()) {
                playEntranceAnimation();
                return;
            }
            if (elapsed >= TILE_TIMEOUT_MS) {
                settleAtChina();
                return;
            }
            requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    function playEntranceAnimation() {
        entranceActive = true;
        markEntranceSeen();
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
        markEntranceSeen();
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000) // 中国大致中心，整球可见
        });
    } else {
        scheduleEntranceAnimation();
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
    // 城市聚合键：优先 adcode（城市名可能被手动改过写法，"大理市"/"大理白族自治州" 要算同一座城），
    // 没有 adcode 才退回城市名。卡片墙、城市视图、重走同城判定、明信片统计共用这一个键。
    function cityKeyOf(fp) {
        if (!fp) return '';
        const code = String(fp.cityAdcode || '').trim();
        if (code) return code;
        return String(fp.city || '').trim();
    }

    function buildCityMarkers() {
        // 先按聚合键分组，再决定显示用的城市名（取该组里出现次数最多的写法）
        const groups = new Map();
        FOOTPRINTS.forEach((fp, i) => {
            const name = String(fp.city || '').trim() || '未分类';
            const key = cityKeyOf(fp) || name;
            if (!groups.has(key)) groups.set(key, { key, names: new Map(), indices: [] });
            const group = groups.get(key);
            group.indices.push(i);
            group.names.set(name, (group.names.get(name) || 0) + 1);
        });
        cityList = [...groups.values()].map(group => {
            let best = '未分类';
            let bestCount = 0;
            group.names.forEach((count, name) => {
                if (count > bestCount) { best = name; bestCount = count; }
            });
            // key 保留聚合键：城市卡片的"只看这座城市的票根"要用它比对
            return { city: best, key: group.key, indices: group.indices };
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
        if (city && cityRevealRaf) {
            cancelAnimationFrame(cityRevealRaf);
            cityRevealRaf = null;
            markerEntities.forEach(ent => {
                if (ent && ent.billboard) {
                    ent.billboard.width = 25;
                    ent.billboard.height = 25;
                }
            });
        }
        cityMode = city;
        cityMarkerEntities.forEach(ent => { ent.show = city; });
        markerEntities.forEach(ent => { ent.show = !city; });
        buildMarkerFocusButtons();
        hideMarkerTip();
        const card = document.getElementById('cityCard');
        if (city && card) card.classList.remove('is-revealed');
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
    const markerCardActions = markerCard.querySelector('.marker-card-actions');
    const markerCardTicket = document.getElementById('markerCardTicket');
    const markerCardGallery = document.getElementById('markerCardGallery');
    const cityCard = document.getElementById('cityCard');
    const cityCardMedia = document.getElementById('cityCardMedia');
    const cityCardTitle = document.getElementById('cityCardTitle');
    const cityCardMeta = document.getElementById('cityCardMeta');
    const cityCardDesc = document.getElementById('cityCardDesc');
    const cityCardGallery = document.getElementById('cityCardGallery');
    const cityCardLocate = document.getElementById('cityCardLocate');
    let activeCityIndex = -1;
    let cityCardTriggerBtn = null;
    markerCardReady = true;   // 标记卡已就绪，可响应整球视图自动关闭
    let activeFootprintIndex = -1;
    let markerRestoreRaf = null;

    function setMarkerSelected(index) {
        if (markerRestoreRaf) {
            cancelAnimationFrame(markerRestoreRaf);
            markerRestoreRaf = null;
        }
        if (cityRevealRaf) {
            cancelAnimationFrame(cityRevealRaf);
            cityRevealRaf = null;
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

    // 浮层显隐统一先处理焦点：隐藏时先 blur，再置 inert，最后更新 aria-hidden，
    // 避免“焦点停留在 aria-hidden=true 的祖先内”造成的无障碍警告。
    function setOverlayHidden(el, hidden) {
        if (!el) return;
        if (hidden && el.contains && el.contains(document.activeElement)) {
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        }
        if ('inert' in el) {
            el.inert = !!hidden;
        }
        el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }

    function hideMarkerCard() {
        document.body.classList.remove('card-open');   // 恢复右下角浮动按钮
        if (!markerCard.classList.contains('visible')) return;
        markerCard.classList.remove('visible');
        // 注意：这里要的是「那个按钮」，不是判断结果 —— 直接写 && 链会得到布尔值，
        // 后面调 .focus() 会抛 TypeError（键盘打开卡片后再点「打开图片墙」会因此打不开图墙）
        const keyboardRestore = (lastKeyboardMarkerBtn &&
            lastKeyboardMarkerBtn.isConnected &&
            markerCard.contains(document.activeElement))
            ? lastKeyboardMarkerBtn
            : null;
        lastKeyboardMarkerBtn = null;
        setOverlayHidden(markerCard, true);
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
        if (keyboardRestore) {
            keyboardRestore.focus();
        }
    }

    // ================= 详情卡主图：加载成功显示图片，失败回退首字占位 + 重试 =================
    let cardImgLoadId = 0;   // 防止快速切换卡片时旧请求覆盖新图

    // 主图右下角的“共 N 张”角标：纯展示，图片加载状态变化后重新挂载；
    // 进图片墙的入口统一交给卡片里的「打开图片墙」按钮，避免同一去处挂两个可点入口
    function refreshCardMediaGallery(fp) {
        const old = document.getElementById('markerCardMediaGallery');
        if (old) old.remove();
        const imgs = fp ? cityWallImages(fp) : [];
        if (!imgs.length) return;
        const chip = document.createElement('span');
        chip.id = 'markerCardMediaGallery';
        chip.className = 'marker-card-media-gallery';
        chip.textContent = '共 ' + imgs.length + ' 张';
        markerCardMedia.appendChild(chip);
    }

    function showCardMonogram(fp, showRetry) {
        markerCardMedia.classList.add('no-image');
        markerCardMedia.style.backgroundImage = 'none';
        markerCardMedia.innerHTML =
            '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>' +
            (showRetry ? '<button class="marker-card-retry" type="button">重试</button>' : '');
        refreshCardMediaGallery(fp);
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
        refreshCardMediaGallery(fp);
        const img = new Image();
        img.onload = () => {
            if (myId !== cardImgLoadId) return;   // 已被更新的卡片取代
            markerCardMedia.classList.remove('no-image');
            markerCardMedia.style.backgroundImage = 'url("' + fp.image + '")';
            markerCardMedia.innerHTML = '';
            refreshCardMediaGallery(fp);
        };
        img.onerror = () => {
            if (myId !== cardImgLoadId) return;
            showCardMonogram(fp, true);   // 图片失败：首字占位 + 重试
        };
        img.src = fp.image;
    }

    function showMarkerCard(fp, index) {
        hideCityCard(false);
        if (autoRotate) setAutoRotate(false);   // 打开足迹详情卡后停止地球自动旋转
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

        // 足迹详情卡动作：只有配置了票根的足迹才提供“打开票根”，无票根时整行隐藏。
        const hasTicket = !!ticketImageUrl(fp.ticketImage);
        const hasGallery = cityWallImages(fp).length > 0;
        markerCardGallery.hidden = !hasGallery;
        markerCardTicket.hidden = !hasTicket;
        markerCardActions.hidden = !hasGallery && !hasTicket;

        if (fp.image) {
            loadCardImage(fp);
        } else {
            showCardMonogram(fp, false);
        }

        setMarkerSelected(index);
        markerCard.classList.add('visible');
        document.body.classList.add('card-open');   // 隐藏右下角浮动按钮，避免遮挡
        setOverlayHidden(markerCard, false);
    }

    document.getElementById('markerCardClose').addEventListener('click', hideMarkerCard);

    // 打开票根：跳到票根墙并定位到当前足迹对应的那张票根
    markerCardTicket.addEventListener('click', () => {
        if (activeFootprintIndex < 0) return;
        const fp = FOOTPRINTS[activeFootprintIndex];
        if (!fp || !ticketImageUrl(fp.ticketImage)) return;
        const items = ticketItemsFromFootprints();
        // 优先按足迹唯一 key 定位，避免对象替换/顺序变化时错配到其他票根
        let ticketIndex = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
        if (ticketIndex < 0) ticketIndex = items.indexOf(fp);
        if (ticketIndex < 0) return;
        hideMarkerCard();
        setTicketView(true, ticketIndex, false);   // 从足迹卡进入票根时不自动开启地球旋转
    });

    // 城市卡只展示已有足迹的聚合信息，不创建或维护独立的城市数据。
    function cityViewItems(ci) {
        const city = cityList[ci];
        return city ? city.indices.map(i => FOOTPRINTS[i]).filter(Boolean) : [];
    }

    function cityPhotoItems(ci) {
        return cityViewItems(ci).flatMap(fp => cityWallImages(fp));
    }

    // 点击城市后的落地视角：以该城市的平均位置为中心，停在展开阈值下方、
    // 但不需要贴到具体足迹点的高度——落地瞬间即可展开足迹，保持“城市上空”的整体视野。
    function cityFlightTarget(ci) {
        const city = cityList[ci];
        const center = city && cityCenter(city);
        if (!center) return null;
        return { lng: center.lng, lat: center.lat, height: CITY_VIEW_HEIGHT };
    }

    // 城市飞行落地收尾：moveEnd 与兜底定时器都可能触发，只执行一次。
    // 落地后按高度执行与手动缩放一致的 聚合/展开 切换（阈值带逻辑不变）。
    function finishCityFlight() {
        if (cityFlightTimer !== null) {
            clearTimeout(cityFlightTimer);
            cityFlightTimer = null;
        }
        if (cityMoveEndHandler) {
            viewer.camera.moveEnd.removeEventListener(cityMoveEndHandler);
            cityMoveEndHandler = null;
        }
        cityFlightActive = false;
        const ci = cityFlightIndex;
        cityFlightIndex = -1;
        if (ci < 0) return;
        const h = viewer.camera.positionCartographic.height;
        if (cityMode && h < CITY_EXPAND_HEIGHT) {
            revealCityFootprints(ci);
        } else if (!cityMode && h > CITY_COLLAPSE_HEIGHT) {
            applyMarkerMode(true);
        }
    }

    // 展开为单个足迹：切换模式后，让该城市的标记点从 0 尺寸依次长大，
    // 形成“聚合点散开”的空间连续感；系统减弱动效时直接切换。
    function revealCityFootprints(ci) {
        const city = cityList[ci];
        if (!city || !city.indices.length) return;
        const alreadyExpanded = !cityMode;
        applyMarkerMode(false);
        const card = document.getElementById('cityCard');
        if (card) card.classList.add('is-revealed');
        if (alreadyExpanded || reduceMotion) return;
        if (cityRevealRaf) cancelAnimationFrame(cityRevealRaf);
        const indices = city.indices.slice();
        indices.forEach(fi => {
            const ent = markerEntities[fi];
            if (ent && ent.billboard) {
                ent.billboard.width = 0;
                ent.billboard.height = 0;
            }
        });
        const startedAt = performance.now();
        const STEP_MS = 55;
        const DURATION_MS = 420;
        const tick = (now) => {
            let pending = false;
            indices.forEach((fi, k) => {
                const ent = markerEntities[fi];
                if (!ent || !ent.billboard) return;
                const t = (now - startedAt - k * STEP_MS) / DURATION_MS;
                if (t >= 1) {
                    ent.billboard.width = 25;
                    ent.billboard.height = 25;
                } else if (t > 0) {
                    pending = true;
                    const eased = 1 - Math.pow(1 - t, 3);
                    ent.billboard.width = Math.max(1, Math.round(25 * eased));
                    ent.billboard.height = Math.max(1, Math.round(25 * eased));
                }
            });
            if (pending && !cityMode) {
                cityRevealRaf = requestAnimationFrame(tick);
            } else {
                cityRevealRaf = null;
            }
        };
        cityRevealRaf = requestAnimationFrame(tick);
    }

    // 飞往城市：终点按足迹分布计算，落地瞬间自动展开该城市的足迹点。
    function flyToCity(ci) {
        if (cityFlightActive && cityFlightIndex === ci) return;   // 同一城市飞行进行中不重复起飞
        const target = cityFlightTarget(ci);
        if (!target) return;
        const duration = reduceMotion ? 0 : 1.8;
        if (cityFlightTimer !== null) {
            clearTimeout(cityFlightTimer);
            cityFlightTimer = null;
        }
        if (cityMoveEndHandler) {
            viewer.camera.moveEnd.removeEventListener(cityMoveEndHandler);
            cityMoveEndHandler = null;
        }
        cityFlightActive = true;
        cityFlightIndex = ci;
        if (duration > 0) {
            cityMoveEndHandler = finishCityFlight;
            viewer.camera.moveEnd.addEventListener(cityMoveEndHandler);
            cityFlightTimer = setTimeout(finishCityFlight, duration * 1000 + 600);
        }
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, target.height),
            duration: duration
        });
        if (duration <= 0) finishCityFlight();
    }

    function showCityCard(ci, triggerBtn) {
        const city = cityList[ci];
        if (!city) return;
        if (autoRotate) setAutoRotate(false);   // 打开城市聚合卡后停止地球自动旋转
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityView.classList.contains('show')) closeCityView(false);
        hideMarkerTip();

        activeCityIndex = ci;
        cityCardTriggerBtn = triggerBtn || null;
        const fps = cityViewItems(ci);
        const photos = cityPhotoItems(ci);
        const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop();
        const types = [...new Set(fps.map(fp => fp.footprintType).filter(Boolean))];
        cityCardTitle.textContent = city.city;
        cityCardMeta.textContent = fps.length + ' 个足迹 · ' + photos.length + ' 张照片' +
            (latest ? ' · 最近 ' + formatCityDate(latest) : '');
        cityCardDesc.textContent = types.length
            ? '记录类型：' + types.join('、')
            : '这座城市的旅行足迹与照片收藏';
        cityCardMedia.classList.toggle('no-image', !photos.length);
        cityCardMedia.style.backgroundImage = photos.length ? 'url("' + photos[0].url + '")' : 'none';
        cityCardMedia.textContent = photos.length ? '' : (city.city ? city.city.charAt(0) : '?');
        cityCard.classList.add('visible');
        setOverlayHidden(cityCard, false);
        flyToCity(ci);
    }

    function hideCityCard(returnFocus = true) {
        if (!cityCard.classList.contains('visible')) return;
        cityCard.classList.remove('visible');
        cityCard.classList.remove('is-revealed');
        setOverlayHidden(cityCard, true);
        const trigger = cityCardTriggerBtn;
        cityCardTriggerBtn = null;
        activeCityIndex = -1;
        if (returnFocus && trigger) trigger.focus();
    }

    document.getElementById('cityCardClose').addEventListener('click', () => hideCityCard());
    cityCardLocate.addEventListener('click', () => {
        if (activeCityIndex >= 0) flyToCity(activeCityIndex);
    });
    cityCardGallery.addEventListener('click', () => {
        if (activeCityIndex < 0) return;
        const ci = activeCityIndex;
        const trigger = cityCardTriggerBtn;
        hideCityCard(false);
        openCityView(ci, trigger);
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

    // 点击足迹打开详情卡；点击城市标记显示城市聚合卡；点击空白处关闭
    markerPickHandler.setInputAction((movement) => {
        const found = findPickedMarker(viewer.scene.pick(movement.position));
        if (found && found.type === 'footprint') {
            showMarkerCard(FOOTPRINTS[found.index], found.index);
        } else if (found && found.type === 'city') {
            showCityCard(found.index);
        } else if (markerCard.classList.contains('visible')) {
            hideMarkerCard();
        } else if (cityCard.classList.contains('visible')) {
            hideCityCard();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ================= 标记键盘可达（Tab 聚焦 → Enter 打开详情卡） =================
    // 每个标记对应一个屏幕外按钮；聚焦时在球面上亮出该标记名称，
    // 键盘激活后焦点移入详情卡，关闭时再回到标记按钮。
    function buildMarkerFocusButtons() {
        markerFocusLayer.innerHTML = '';
        if (cityMode) {
                // 城市模式：聚焦显示「城市 · N 个足迹」，Enter 打开城市聚合卡
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
                    showCityCard(ci, e.detail === 0 ? btn : null);
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

    // 从足迹详情卡进入“城市图片墙”：直接使用城市卡打开的那套全屏视图，
    // 并自动选中当前足迹；关闭后还原到原来的足迹详情卡。
    function openFootprintAlbum(fp, triggerEl) {
        if (!fp) return;
        const fpIndex = FOOTPRINTS.indexOf(fp);
        if (fpIndex < 0) return;
        const cityIndex = cityList.findIndex(city => city.indices.includes(fpIndex));
        if (cityIndex < 0) return;
        const tabIndex = cityList[cityIndex].indices.indexOf(fpIndex);
        if (tabIndex < 0) return;

        // 记录关闭后要还原的足迹卡
        cityViewRestoreCard = {
            fpIndex,
            trigger: triggerEl || null
        };
        openCityView(cityIndex, null);
        cityViewTabIndex = tabIndex;
        selectCityViewTab(tabIndex);
    }

    markerCardGallery.addEventListener('click', () => {
        if (activeFootprintIndex < 0) return;
        const fp = FOOTPRINTS[activeFootprintIndex];
        if (fp) openFootprintAlbum(fp, markerCardGallery);
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
        setOverlayHidden(lightbox, false);
        document.getElementById('lightboxClose').focus();
        renderLightboxImage();
    }

    function closeLightbox(returnFocus = true) {
        lightbox.classList.remove('show');
        setOverlayHidden(lightbox, true);
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

    // ================= 城市足迹全屏视图（左侧足迹 Tab 卡片 + 右侧详情） =================
    const cityView = document.getElementById('cityView');
    const cityViewBack = document.getElementById('cityViewBack');
    const cityViewBackLabel = document.getElementById('cityViewBackLabel');
    const cityViewTitle = document.getElementById('cityViewTitle');
    const cityViewCityList = document.getElementById('cityViewCityList');
    const cityViewStats = document.getElementById('cityViewStats');
    const cityViewTimeline = document.getElementById('cityViewTimeline');
    const cityViewTimelineList = document.getElementById('cityViewTimelineList');
    const cityViewTimelineToggle = document.getElementById('cityViewTimelineToggle');
    const cityViewTimelineCount = document.getElementById('cityViewTimelineCount');
    const cityViewMeta = document.getElementById('cityViewMeta');
    const cityViewTickets = document.getElementById('cityViewTickets');
    const cityViewPrevCity = document.getElementById('cityViewPrevCity');
    const cityViewNextCity = document.getElementById('cityViewNextCity');
    const cityTabs = document.getElementById('cityTabs');
    const cityStage = document.getElementById('cityStage');
    let cityStageObserver = null;   // 手账照片墙滚动到底自动加载的观察器
    let cityViewCityIndex = -1;      // 当前城市（cityList 下标）
    let cityViewTabIndex = 0;        // 当前选中的足迹 Tab
    let cityViewTriggerBtn = null;   // 键盘触发时的返回焦点按钮
    let cityViewRestoreCard = null;  // 从足迹卡进入城市图片墙时，关闭后要还原的足迹卡
    let cityViewFromWall = false;    // 当前图片墙是否从城市卡片墙展开（返回时回到卡片墙）

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

    function cleanupCityStageAutoLoad() {
        if (cityStageObserver) {
            cityStageObserver.disconnect();
            cityStageObserver = null;
        }
    }

    function renderCityStage(fp, photoLimit = 8, preserveScroll = false) {
        cleanupCityStageAutoLoad();
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
            // 滚动到此处附近时自动加载下一批，不再需要手动点击
            const sentinel = document.createElement('div');
            sentinel.className = 'city-journal-more city-journal-more-auto';
            sentinel.setAttribute('role', 'status');
            sentinel.textContent = '已加载 ' + visibleImages.length + ' / ' + imgs.length + ' 张 · 继续向下自动加载';
            journal.appendChild(sentinel);
        }
        content.appendChild(journal);

        cityStage.innerHTML = '';
        cityStage.appendChild(content);
        cityStage.scrollTop = preserveScroll ? prevScrollTop : 0;

        // 观察加载哨兵：靠近底部时再渲染下一批。
        // 延迟到下一帧再开始观察，避免刚设置 scrollTop=0 时误判为已到达底部。
        if (imgs.length > visibleImages.length && 'IntersectionObserver' in window) {
            const nextLimit = Math.min(visibleImages.length + 8, imgs.length);
            requestAnimationFrame(() => {
                const sentinel = cityStage.querySelector('.city-journal-more-auto');
                if (!sentinel || !sentinel.isConnected) return;
                cityStageObserver = new IntersectionObserver(entries => {
                    if (entries.some(entry => entry.isIntersecting)) {
                        cleanupCityStageAutoLoad();
                        renderCityStage(fp, nextLimit, true);
                    }
                }, {
                    root: cityStage,
                    rootMargin: '0px 0px 180px 0px',
                    threshold: 0.01
                });
                cityStageObserver.observe(sentinel);
            });
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
        // 时间线跟着高亮当前那一站
        if (cityViewTimelineList) {
            cityViewTimelineList.querySelectorAll('.city-view-timeline-item').forEach(el => {
                el.classList.toggle('is-active', el.dataset.tabIndex === String(cityViewTabIndex));
            });
        }
        renderCityStage(fps[cityViewTabIndex]);
    }

    // 到访时间线：把"第几次来、隔了多久"讲清楚。
    // 只有一次到访也显示（就一条"第 1 次"），否则用户会以为这个功能没生效
    // 「到访」和「看这座城市的票根」都不显示时，整条操作行收起来，别在标题下留一条空行
    function syncCityViewMeta() {
        if (!cityViewMeta) return;
        const hasTimeline = cityViewTimeline && !cityViewTimeline.hidden;
        const hasTickets = cityViewTickets && !cityViewTickets.hidden;
        cityViewMeta.hidden = !hasTimeline && !hasTickets;
    }

    // 手机端到访折成一颗胶囊，点开才展开那一排；桌面端这颗按钮由 CSS 隐藏
    function setCityViewTimelineExpanded(expanded) {
        if (!cityViewTimeline) return;
        cityViewTimeline.classList.toggle('is-expanded', !!expanded);
        if (!cityViewTimelineToggle) return;
        const count = cityViewTimelineList ? cityViewTimelineList.children.length : 0;
        cityViewTimelineToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        cityViewTimelineToggle.setAttribute('aria-label',
            (expanded ? '收起到访记录' : '展开到访记录') + '，共 ' + count + ' 次');
    }

    function renderCityViewTimeline(fps) {
        if (!cityViewTimeline || !cityViewTimelineList) return;
        cityViewTimelineList.innerHTML = '';
        const visits = fps
            .map((fp, i) => ({ fp, i, time: String(fp.createTime || '') }))
            .filter(visit => visit.time)
            .sort((a, b) => a.time.localeCompare(b.time));
        if (!visits.length) {
            cityViewTimeline.hidden = true;
            setCityViewTimelineExpanded(false);
            syncCityViewMeta();
            return;
        }
        visits.forEach((visit, n) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-view-timeline-item' + (visit.i === cityViewTabIndex ? ' is-active' : '');
            btn.dataset.tabIndex = String(visit.i);
            const order = document.createElement('b');
            order.textContent = '第 ' + (n + 1) + ' 次';
            const date = document.createElement('span');
            date.textContent = visit.time.slice(0, 10).replace(/-/g, '.');
            btn.append(order, date);
            if (n > 0) {
                const days = Math.round(
                    (new Date(visit.time).getTime() - new Date(visits[n - 1].time).getTime()) / 86400000
                );
                if (days >= 0) {
                    const gap = document.createElement('em');
                    gap.textContent = '隔 ' + days.toLocaleString('zh-CN') + ' 天';
                    btn.appendChild(gap);
                }
            }
            btn.setAttribute('aria-label',
                '第 ' + (n + 1) + ' 次到访 ' + visit.fp.name + '，' + date.textContent);
            btn.addEventListener('click', () => selectCityViewTab(visit.i));
            li.appendChild(btn);
            cityViewTimelineList.appendChild(li);
        });
        cityViewTimeline.hidden = false;
        if (cityViewTimelineCount) cityViewTimelineCount.textContent = String(visits.length);
        // 换城市时收起，避免上一个城市的展开状态残留
        setCityViewTimelineExpanded(false);
        syncCityViewMeta();
    }

    function renderCityView() {
        const fps = cityViewFootprints();
        cityTabs.innerHTML = '';
        cityStage.innerHTML = '';
        if (cityViewTimeline) cityViewTimeline.hidden = true;
        if (cityViewTimelineList) cityViewTimelineList.innerHTML = '';
        if (cityViewTickets) cityViewTickets.hidden = true;
        syncCityViewMeta();
        if (!fps.length) return;
        const city = cityList[cityViewCityIndex];
        const photoCount = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
        cityViewTitle.textContent = city.city;
        cityViewStats.textContent = fps.length + ' 个足迹 · ' + photoCount + ' 张照片';
        // 这座城市有票根时，给一个键盘也能到达的入口（卡片上的徽章只能鼠标点）
        if (cityViewTickets) {
            const ticketCount = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
            cityViewTickets.hidden = !ticketCount;
            cityViewTickets.textContent = ticketCount
                ? '看这座城市的 ' + ticketCount + ' 张票根'
                : '看这座城市的票根';
        }
        renderCityViewTimeline(fps);

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

    // —— 顶部城市列表（下拉选择器）——
    function cityListMeta(ci) {
        const city = cityList[ci];
        if (!city) return { count: 0, photos: 0 };
        const photos = city.indices.reduce(
            (n, fi) => n + cityWallImages(FOOTPRINTS[fi]).length, 0
        );
        return { count: city.indices.length, photos };
    }

    function goToCityViewCity(ci) {
        if (!cityList[ci] || ci === cityViewCityIndex) return;
        cityViewCityIndex = ci;
        cityViewTabIndex = 0;
        renderCityView();
    }

    function renderCitySwitcher() {
        if (!cityViewCityList) return;
        cityViewCityList.innerHTML = '';
        cityList.forEach((city, ci) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-view-city-option' + (ci === cityViewCityIndex ? ' is-current' : '');
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(ci === cityViewCityIndex));
            const meta = cityListMeta(ci);
            const nameEl = document.createElement('span');
            nameEl.className = 'city-view-city-option-name';
            nameEl.textContent = city.city;
            const countEl = document.createElement('span');
            countEl.className = 'city-view-city-option-count';
            countEl.textContent = meta.count + ' 个足迹 · ' + meta.photos + ' 张照片';
            btn.append(nameEl, countEl);
            btn.addEventListener('click', () => {
                goToCityViewCity(ci);
                closeCitySwitcher();
            });
            cityViewCityList.appendChild(btn);
        });
    }

    function openCitySwitcher() {
        if (!cityViewCityList) return;
        renderCitySwitcher();
        cityViewCityList.hidden = false;
        cityViewTitle.setAttribute('aria-expanded', 'true');
        const current = cityViewCityList.querySelector('.is-current') || cityViewCityList.firstElementChild;
        if (current) current.focus();
    }

    function closeCitySwitcher(returnFocus = false) {
        if (!cityViewCityList || cityViewCityList.hidden) return;
        cityViewCityList.hidden = true;
        cityViewTitle.setAttribute('aria-expanded', 'false');
        if (returnFocus) cityViewTitle.focus();
    }

    function toggleCitySwitcher() {
        if (cityViewCityList && cityViewCityList.hidden) openCitySwitcher();
        else closeCitySwitcher(true);
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
        // 两级浏览：从卡片墙进入时保持卡片墙在下一层，返回按钮文案切换为“返回城市墙”
        const fromWall = !!(cityWall && cityWall.classList.contains('show'));
        cityViewFromWall = fromWall;
        if (fromWall) {
            if (cityViewBackLabel) cityViewBackLabel.textContent = '返回城市墙';
            cityViewBack.setAttribute('aria-label', '返回城市墙');
        } else {
            if (cityViewBackLabel) cityViewBackLabel.textContent = '返回地球';
            cityViewBack.setAttribute('aria-label', '返回地球');
        }
        // 城市图片墙为不透明全屏层，先暂停地球渲染循环，释放主线程/合成带宽
        setGlobeRenderLoop(false);
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityCard.classList.contains('visible')) hideCityCard(false);
        hideMarkerTip();
        cityViewCityIndex = ci;
        cityViewTabIndex = 0;
        cityViewTriggerBtn = triggerBtn || null;
        renderCityView();
        cityView.classList.add('show');
        setOverlayHidden(cityView, false);
        // 城市图片墙打开时直接隐藏顶部导航，不依赖相机事件（渲染循环暂停时相机事件不会触发）
        document.body.classList.add('city-view-open');
        // 触屏不自动回焦，避免“返回地球”出现焦点描边；
        // 注意 .show 刚加上时整层还是 visibility: hidden（离散过渡约在 130ms 后才翻转），
        // 此时直接 focus() 会被浏览器忽略，键盘用户会停在原来的按钮上，所以要等它真的可见
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            focusCityViewBackWhenVisible();
        }
    }

    let cityViewFocusRaf = 0;
    function focusCityViewBackWhenVisible() {
        cancelAnimationFrame(cityViewFocusRaf);
        const tick = () => {
            if (!cityView.classList.contains('show')) return;   // 已经关掉就别再抢焦点
            if (getComputedStyle(cityViewBack).visibility === 'hidden') {
                cityViewFocusRaf = requestAnimationFrame(tick);
                return;
            }
            cityViewBack.focus();
        };
        cityViewFocusRaf = requestAnimationFrame(tick);
    }

    function closeCityView(returnFocus = true) {
        cancelAnimationFrame(cityViewFocusRaf);
        const fromWall = cityViewFromWall;
        cityViewFromWall = false;
        if (lightbox.classList.contains('show')) closeLightbox(false);
        cityView.classList.remove('show');
        setOverlayHidden(cityView, true);
        document.body.classList.remove('city-view-open');
        // 回到卡片墙时地球仍暂停；只有真正回到地球才恢复渲染
        if (!fromWall || !(cityWall && cityWall.classList.contains('show'))) {
            setGlobeRenderLoop(true);
        }
        closeCitySwitcher();
        const restore = cityViewRestoreCard;
        cityViewRestoreCard = null;
        if (returnFocus) {
            if (fromWall && cityWall && cityWall.classList.contains('show')) {
                // 等图片墙淡出后把焦点还给卡片墙的返回按钮
                setTimeout(() => {
                    if (cityWallBack && cityWallBack.isConnected &&
                        cityWall.classList.contains('show')) {
                        cityWallBack.focus();
                    }
                }, 280);
                return;
            }
            if (restore) {
                const fp = FOOTPRINTS[restore.fpIndex];
                if (fp) {
                    showMarkerCard(fp, restore.fpIndex);
                    const target = restore.trigger && restore.trigger.isConnected
                        ? restore.trigger
                        : markerCardGallery;
                    if (target) {
                        // 等卡片可见过渡结束后再回焦，避免焦点落在仍不可见的容器里
                        setTimeout(() => { if (target.isConnected) target.focus(); }, 480);
                    }
                }
            } else if (cityViewTriggerBtn) {
                cityViewTriggerBtn.focus();
                cityViewTriggerBtn = null;
            }
        }
    }

    cityViewBack.addEventListener('click', () => closeCityView());
    if (cityViewTimelineToggle) {
        cityViewTimelineToggle.addEventListener('click', () => {
            setCityViewTimelineExpanded(!cityViewTimeline.classList.contains('is-expanded'));
        });
    }
    cityViewTickets.addEventListener('click', () => {
        if (cityViewCityIndex >= 0) openTicketGalleryForCity(cityViewCityIndex);
    });
    cityViewPrevCity.addEventListener('click', () => switchCityViewCity(-1));
    cityViewNextCity.addEventListener('click', () => switchCityViewCity(1));
    cityView.addEventListener('click', (e) => {
        if (e.target === cityView) closeCityView();
    });
    // 城市名可点击：展开城市下拉列表
    cityViewTitle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCitySwitcher();
    });
    cityViewCityList.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        if (cityView.classList.contains('show') &&
            cityViewCityList && !cityViewCityList.hidden &&
            !e.target.closest('.city-view-head')) {
            closeCitySwitcher();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (cityViewCityList && !cityViewCityList.hidden && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeCitySwitcher(true);
        }
    }, true);
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

    // ================= 城市卡片墙（城市总览目录） =================
    // 与城市图片墙共用 FOOTPRINTS / cityList：卡片点击后直接进入现有 openCityView，
    // 不做重复的城市详情实现。卡片按“最近去过时间”倒序排列。
    const cityWall = document.getElementById('cityWall');
    const cityWallBtn = document.getElementById('cityWallBtn');
    const cityWallBack = document.getElementById('cityWallBack');
    const cityWallTitle = document.getElementById('cityWallTitle');
    const cityWallStats = document.getElementById('cityWallStats');
    const cityWallGrid = document.getElementById('cityWallGrid');
    const cityWallEmpty = document.getElementById('cityWallEmpty');
    const cityWallBody = document.getElementById('cityWallBody');
    const cityWallTimeCapsuleBtn = document.getElementById('cityWallTimeCapsuleBtn');
    const cityWallInsightBtn = document.getElementById('cityWallInsightBtn');
    const cityWallProvinceFilter = document.getElementById('cityWallProvinceFilter');
    // 只看某个省（从足迹洞察的省份排行点进来）；关闭卡片墙时自动清掉
    let cityWallProvinceFilterName = '';

    // 4 个创意功能的开关统一从后台 globe3d 设置读取（默认开启）
    function featureEnabled(key) {
        const value = footprintCfg && footprintCfg[key];
        return value !== false;
    }

    // 城市卡片封面缩略：独立使用后台“城市卡片墙图片”的 from→to→suffix 规则；
    // 三项都留空时回退到“标记点图片”的 from→to 规则，保持升级前的行为不变。
    function cityCardImageUrl(url) {
        if (!url || !footprintCfg) return url;
        const cityFrom = footprintCfg.cityWallImageFrom;
        const cityTo = footprintCfg.cityWallImageTo;
        const citySuffix = footprintCfg.cityWallImageSuffix;
        if (!cityFrom && !cityTo && !citySuffix) {
            // 独立规则未配置：完全沿用旧版的标记点 from→to 替换逻辑
            const from = footprintCfg.markerImageFrom;
            const to = footprintCfg.markerImageTo;
            if (from && to && String(url).includes(from)) {
                return String(url).split(from).join(to);
            }
            return url;
        }
        let out = String(url);
        if (cityFrom) out = out.split(cityFrom).join(cityTo || '');
        if (citySuffix && !out.endsWith(citySuffix)) out += citySuffix;
        return out;
    }

    // 移动端城市卡片墙每排数量：由后台 3D 地球设置注入，前端按 1-3 兜底
    const CITY_WALL_MOBILE_MIN = 1;
    const CITY_WALL_MOBILE_MAX = 3;
    function resolveMobileCityWallColumns() {
        const raw = Number(footprintCfg && footprintCfg.mobileCityWallColumns);
        if (!Number.isFinite(raw)) return 2;
        return Math.min(CITY_WALL_MOBILE_MAX, Math.max(CITY_WALL_MOBILE_MIN, Math.round(raw)));
    }

    // 地球渲染循环：票根墙需要透明背景透出地球，保持渲染；不透明全屏层打开时暂停
    function setGlobeRenderLoop(running) {
        if (!viewer) return;
        try {
            if (running && !viewer.useDefaultRenderLoop) {
                viewer.useDefaultRenderLoop = true;
            } else if (!running && viewer.useDefaultRenderLoop) {
                viewer.useDefaultRenderLoop = false;
            }
        } catch (e) { /* 暂停/恢复失败不影响页面功能 */ }
    }

    // 封面图限量解码队列：滚动时一次只解码少数图片，避免栅格线程被批量解码占满
    const CITY_WALL_COVER_CONCURRENCY = 3;   // 同时解码/加载的封面数
    const CITY_WALL_COVER_MARGIN = 700;      // 提前加载的距离（px）
    const cityWallCoverQueue = [];
    let cityWallCoverLoading = 0;
    let cityWallCoverObserver = null;
    let cityWallCoverDrainScheduled = false;

    function drainCityWallCoverQueue() {
        cityWallCoverDrainScheduled = false;
        while (cityWallCoverLoading < CITY_WALL_COVER_CONCURRENCY && cityWallCoverQueue.length) {
            const media = cityWallCoverQueue.shift();
            if (!media || !media.isConnected) continue;
            const img = media.querySelector('img.city-wall-card-cover');
            if (!img || !img.dataset.src || img.getAttribute('src')) continue;
            cityWallCoverLoading++;
            img.src = img.dataset.src;
        }
    }

    function scheduleCityWallCoverDrain() {
        if (cityWallCoverDrainScheduled) return;
        cityWallCoverDrainScheduled = true;
        requestAnimationFrame(drainCityWallCoverQueue);
    }

    function cityWallCoverFinished() {
        cityWallCoverLoading = Math.max(0, cityWallCoverLoading - 1);
        scheduleCityWallCoverDrain();
    }

    function stopCityWallCoverLoader() {
        if (cityWallCoverObserver) {
            cityWallCoverObserver.disconnect();
            cityWallCoverObserver = null;
        }
        cityWallCoverQueue.length = 0;
        cityWallCoverLoading = 0;
        cityWallCoverDrainScheduled = false;
    }

    function startCityWallCoverLoader() {
        stopCityWallCoverLoader();
        const pending = cityWallGrid.querySelectorAll('.city-wall-card-media.is-loading');
        if (!pending.length) return;
        // 不支持 IntersectionObserver 时回退为立即加载（与原生 lazy 行为相近）
        if (!('IntersectionObserver' in window) || !cityWallBody) {
            pending.forEach(media => {
                const img = media.querySelector('img.city-wall-card-cover');
                if (img && img.dataset.src) img.src = img.dataset.src;
            });
            return;
        }
        cityWallCoverObserver = new IntersectionObserver(entries => {
            let enqueued = false;
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const media = entry.target;
                if (media.dataset.coverQueued) return;
                media.dataset.coverQueued = '1';
                cityWallCoverQueue.push(media);
                enqueued = true;
            });
            if (enqueued) scheduleCityWallCoverDrain();
        }, {
            root: cityWallBody,
            rootMargin: '0px 0px ' + CITY_WALL_COVER_MARGIN + 'px 0px',
            threshold: 0.01
        });
        pending.forEach(media => cityWallCoverObserver.observe(media));
    }

    // ============ 卡片墙图片空闲预热 ============
    // 刷新后磁盘缓存里的图片仍要重新解码；滚动时再解码就会造成帧断。
    // 打开卡片墙后以低并发在后台把封面与轮播图全部解码，滚动时不再等待。
    const CITY_WALL_WARM_CONCURRENCY = 2;
    const CITY_WALL_WARM_MAX_IMAGES = 60;   // 防止超大城市列表过度预热
    const cityWallWarmQueue = [];
    let cityWallWarmLoading = 0;
    let cityWallWarmTimer = null;

    function drainCityWallWarmQueue() {
        cityWallWarmTimer = null;
        while (cityWallWarmLoading < CITY_WALL_WARM_CONCURRENCY && cityWallWarmQueue.length) {
            const img = cityWallWarmQueue.shift();
            if (!img || !img.isConnected || img.getAttribute('src')) continue;
            cityWallWarmLoading++;
            const done = () => {
                cityWallWarmLoading = Math.max(0, cityWallWarmLoading - 1);
                if (!cityWallWarmTimer) {
                    cityWallWarmTimer = setTimeout(drainCityWallWarmQueue, 0);
                }
            };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            img.src = img.dataset.src;
        }
    }

    function stopCityWallWarmQueue() {
        if (cityWallWarmTimer) {
            clearTimeout(cityWallWarmTimer);
            cityWallWarmTimer = null;
        }
        cityWallWarmQueue.length = 0;
        cityWallWarmLoading = 0;
    }

    function startCityWallWarmQueue() {
        stopCityWallWarmQueue();
        const imgs = [...cityWallGrid.querySelectorAll(
            'img.city-wall-card-cover, img.city-wall-card-preview')]
            .filter(img => img.dataset.src && !img.getAttribute('src'));
        if (!imgs.length || imgs.length > CITY_WALL_WARM_MAX_IMAGES) return;
        cityWallWarmQueue.push(...imgs);
        drainCityWallWarmQueue();
    }

    // ============ PC 城市卡片悬停轮播（最多 3 张） ============
    const CITY_CARD_CAROUSEL_DELAY = 600;      // 悬停后多久开始
    const CITY_CARD_CAROUSEL_INTERVAL = 1800;  // 每张停留时长
    let cityCardCarouselCard = null;
    let cityCardCarouselTimer = null;
    let cityCardCarouselIndex = 0;
    let cityCardCarouselPauseUntil = 0;

    function loadCityCardPreview(img) {
        if (!img || !img.dataset.src || img.src) return;
        const probe = new Image();
        probe.onload = () => {
            if (!img.isConnected) return;
            img.src = img.dataset.src;
            img.classList.add('is-ready');
        };
        probe.onerror = () => {
            if (!img.isConnected) return;
            img.classList.add('is-error');
        };
        probe.src = img.dataset.src;
    }

    function stopCityCardCarousel() {
        if (cityCardCarouselTimer) {
            clearTimeout(cityCardCarouselTimer);
            cityCardCarouselTimer = null;
        }
        if (cityCardCarouselCard) {
            cityCardCarouselCard.classList.remove('is-carouseling');
            cityCardCarouselCard.querySelectorAll('.city-wall-card-preview').forEach(img => {
                img.classList.remove('is-active');
            });
        }
        cityCardCarouselCard = null;
        cityCardCarouselIndex = 0;
    }

    function stepCityCardCarousel() {
        if (Date.now() < cityCardCarouselPauseUntil) return;
        const card = cityCardCarouselCard;
        if (!card || !card.isConnected) {
            stopCityCardCarousel();
            return;
        }
        const imgs = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
            .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
        if (imgs.length < 2) return;
        cityCardCarouselIndex = (cityCardCarouselIndex + 1) % imgs.length;
        imgs.forEach((img, i) => img.classList.toggle('is-active', i === cityCardCarouselIndex));
    }

    function startCityCardCarousel(card) {
        if (!featureEnabled('cityCardHoverCarousel')) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (cityCardCarouselCard === card && cityCardCarouselTimer) return;
        stopCityCardCarousel();
        cityCardCarouselCard = card;
        const boot = () => {
            if (!card.isConnected) {
                stopCityCardCarousel();
                return;
            }
            if (Date.now() < cityCardCarouselPauseUntil) {
                cityCardCarouselTimer = setTimeout(boot, 150);
                return;
            }
            // 真正开始轮播时才加载后续图片，一次只加载本卡 2 张
            card.querySelectorAll('.city-wall-card-preview').forEach(img => {
                if (!img.src && img.dataset.src) loadCityCardPreview(img);
            });
            card.classList.add('is-carouseling');
            const ready = [...card.querySelectorAll('.city-wall-card-cover, .city-wall-card-preview')]
                .filter(img => img.getAttribute('src') && !img.classList.contains('is-error'));
            if (ready.length) {
                ready.forEach((img, i) => img.classList.toggle('is-active', i === 0));
            }
            cityCardCarouselIndex = 0;
            cityCardCarouselTimer = setInterval(stepCityCardCarousel, CITY_CARD_CAROUSEL_INTERVAL);
        };
        cityCardCarouselTimer = setTimeout(boot, CITY_CARD_CAROUSEL_DELAY);
    }

    // 滚动时暂停轮播，避免与滚动卡顿叠加
    document.addEventListener('wheel', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });
    document.addEventListener('touchmove', () => {
        cityCardCarouselPauseUntil = Date.now() + 350;
    }, { passive: true });

    function cityWallCardData(ci) {
        const fps = cityViewItems(ci);
        const photos = fps.reduce((n, fp) => n + cityWallImages(fp).length, 0);
        const tickets = fps.reduce((n, fp) => n + (ticketImageUrl(fp.ticketImage) ? 1 : 0), 0);
        const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop() || '';
        // 封面/轮播预览：按最近足迹顺序，从足迹相册中取最多 3 张不重复照片；
        // 单足迹但相册有很多照片的城市也能获得轮播效果；都没有图片时卡片显示首字占位
        const previews = [];
        const previewsRaw = [];   // 与 previews 一一对应的原图地址（明信片出图用）
        const latestFirst = fps.slice().sort((a, b) =>
            String(b.createTime || '').localeCompare(String(a.createTime || '')));
        for (const fp of latestFirst) {
            const imgs = cityWallImages(fp);
            for (const img of imgs) {
                const url = cityCardImageUrl(img.url);
                if (!previews.includes(url)) {
                    previews.push(url);
                    previewsRaw.push(img.url);
                }
                if (previews.length >= 3) break;
            }
            if (previews.length >= 3) break;
        }
        const cover = previews[0] || '';
        const coverRaw = previewsRaw[0] || '';
        const province = fps.map(fp => fp.province).find(Boolean) || '';
        // 城市小结用：第一次到访 + 这座城市里走过的地方（按时间升序）
        const first = fps.map(fp => fp.createTime).filter(Boolean).sort()[0] || '';
        const places = fps
            .slice()
            .sort((a, b) => String(a.createTime || '').localeCompare(String(b.createTime || '')))
            .map(fp => fp.name)
            .filter(Boolean);
        return { count: fps.length, photos, tickets, latest, first, places, cover, coverRaw, province, previews };
    }

    // 「只看某个省」的开关：足迹洞察的省份排行点进来时用，只影响卡片墙这一层
    function renderCityWallProvinceFilter() {
        if (!cityWallProvinceFilter) return;
        cityWallProvinceFilter.hidden = !cityWallProvinceFilterName;
        if (!cityWallProvinceFilterName) return;
        cityWallProvinceFilter.textContent = '只看 ' + cityWallProvinceFilterName + ' ✕';
        cityWallProvinceFilter.setAttribute('aria-label',
            '清除筛选，显示全部城市（当前只看 ' + cityWallProvinceFilterName + '）');
    }

    function setCityWallProvinceFilter(name) {
        cityWallProvinceFilterName = name || '';
        renderCityWall();
        if (cityWallBody) cityWallBody.scrollTop = 0;
    }

    function cityWallCards() {
        const cards = cityList
            .map((city, ci) => ({
                ci,
                name: city.city,
                ...cityWallCardData(ci)
            }))
            .filter(card => !cityWallProvinceFilterName || card.province === cityWallProvinceFilterName);
        // 最近去过的城市排前面，无日期时按名称兜底，保持顺序稳定
        cards.sort((a, b) => {
            const byDate = String(b.latest || '').localeCompare(String(a.latest || ''));
            if (byDate) return byDate;
            return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
        });
        return cards;
    }

    function renderCityWall() {
        if (!cityWall) return;
        stopCityWallCoverLoader();
        stopCityWallWarmQueue();
        stopCityCardCarousel();
        const mobileColumns = resolveMobileCityWallColumns();
        const mobileView = window.matchMedia('(max-width: 820px)').matches;
        cityWall.style.setProperty('--city-wall-mobile-columns', String(mobileColumns));
        // 仅手机端多列（每排 2-3 个）时切换紧凑照片卡样式：图片放大、次要文字隐藏
        cityWall.classList.toggle('city-wall-multi', mobileView && mobileColumns > 1);
        const cards = cityWallCards();
        const cityCount = cards.length;
        const footprintTotal = cards.reduce((n, c) => n + c.count, 0);
        const photoTotal = cards.reduce((n, c) => n + c.photos, 0);
        const ticketTotal = cards.reduce((n, c) => n + c.tickets, 0);
        cityWallTitle.textContent = '城市卡片墙';
        cityWallStats.textContent = cityCount
            ? cityCount + ' 座城市 · ' + footprintTotal + ' 个足迹 · ' + photoTotal + ' 张照片' +
              (ticketTotal ? ' · ' + ticketTotal + ' 张票根' : '')
            : '每一座城市，都值得一张卡片';
        renderCityWallProvinceFilter();
        cityWallGrid.innerHTML = '';
        if (cityWallEmpty) cityWallEmpty.hidden = cityCount > 0;

        cards.forEach(card => {
            const wrap = document.createElement('div');
            wrap.className = 'city-wall-card-wrap';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'city-wall-card' + (card.cover ? '' : ' no-cover');
            btn.dataset.cityIndex = String(card.ci);
            btn.setAttribute('aria-label',
                card.name + (card.province ? '，' + card.province : '') + '，' +
                card.count + ' 个足迹' +
                (card.tickets ? '，' + card.tickets + ' 张票根' : '') + '，打开城市图片墙');

            const media = document.createElement('span');
            media.className = 'city-wall-card-media' + (card.cover ? ' is-loading' : '');
            // 首字占位常驻：封面未加载/加载失败时显示，加载完成后被封面淡入盖住
            const monogram = document.createElement('span');
            monogram.className = 'city-wall-card-monogram';
            monogram.textContent = card.name ? card.name.charAt(0) : '?';
            media.appendChild(monogram);
            if (card.cover) {
                const cover = document.createElement('img');
                cover.className = 'city-wall-card-cover';
                cover.decoding = 'async';
                cover.alt = '';
                cover.dataset.src = card.cover;
                cover.addEventListener('load', () => {
                    if (!cover.isConnected) return;   // 卡片墙已关闭时忽略迟到的解码结果
                    media.classList.remove('is-loading');
                    media.classList.add('is-loaded');
                    cityWallCoverFinished();
                });
                cover.addEventListener('error', () => {
                    if (!cover.isConnected) return;
                    media.classList.remove('is-loading');
                    media.classList.add('is-error');
                    cityWallCoverFinished();
                });
                media.appendChild(cover);
            }
            // 轮播后续图：不参与首图限量队列，hover 时再按需加载（最多共 3 张）
            if (card.previews.length > 1 && featureEnabled('cityCardHoverCarousel')) {
                card.previews.slice(1).forEach(url => {
                    const extra = document.createElement('img');
                    extra.className = 'city-wall-card-preview';
                    extra.decoding = 'async';
                    extra.alt = '';
                    extra.setAttribute('aria-hidden', 'true');
                    extra.dataset.src = url;
                    media.appendChild(extra);
                });
            }
            if (card.tickets) {
                const ticketBadge = document.createElement('span');
                ticketBadge.className = 'city-wall-card-tickets';
                ticketBadge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M13.5 7v2.8M13.5 14.2V17"/></svg>';
                ticketBadge.appendChild(document.createTextNode(card.tickets + ' 张票根'));
                media.appendChild(ticketBadge);
            }

            const body = document.createElement('span');
            body.className = 'city-wall-card-body';
            const eyebrow = document.createElement('span');
            eyebrow.className = 'city-wall-card-eyebrow';
            eyebrow.textContent = card.province || 'TRAVELED';
            const name = document.createElement('strong');
            name.className = 'city-wall-card-name';
            name.textContent = card.name;
            const meta = document.createElement('span');
            meta.className = 'city-wall-card-meta';
            // 桌面展示「足迹 · 照片」；手机端紧凑卡只留一行，显示足迹数（照片数信息量更低）
            meta.textContent = mobileView
                ? (card.count ? card.count + ' 个足迹' : '暂无足迹')
                : card.count + ' 个足迹 · ' + card.photos + ' 张照片';
            body.append(eyebrow, name, meta);
            if (card.latest) {
                const recent = document.createElement('span');
                recent.className = 'city-wall-card-recent';
                recent.textContent = '最近 ' + formatCityDate(card.latest);
                body.appendChild(recent);
            }

            btn.append(media, body);
            btn.addEventListener('click', (event) => {
                const ci = Number(btn.dataset.cityIndex);
                if (!cityList[ci]) return;
                // 点在"N 张票根"徽章上 = 只看这座城市的票根；点其它地方 = 打开城市图片墙
                if (event.target.closest('.city-wall-card-tickets')) {
                    openTicketGalleryForCity(ci);
                    return;
                }
                // 卡片墙保留在下一层，图片墙从上面展开，返回时回到卡片墙并保留滚动位置
                openCityView(ci, null);
            });
            // PC 悬停/键盘聚焦轮播
            btn.addEventListener('mouseenter', () => startCityCardCarousel(btn));
            btn.addEventListener('mouseleave', stopCityCardCarousel);
            btn.addEventListener('focusin', () => startCityCardCarousel(btn));
            btn.addEventListener('focusout', stopCityCardCarousel);
            wrap.appendChild(btn);
            // 明信片入口（独立按钮，避免按钮嵌套）
            if (featureEnabled('enablePostcard')) {
                const postcardBtn = document.createElement('button');
                postcardBtn.type = 'button';
                postcardBtn.className = 'city-wall-card-postcard';
                postcardBtn.textContent = '明信片';
                postcardBtn.setAttribute('aria-label', '为 ' + card.name + ' 生成旅行明信片');
                postcardBtn.addEventListener('click', () => {
                    const ci = Number(btn.dataset.cityIndex);
                    if (cityList[ci]) openPostcard(ci, postcardBtn);
                });
                wrap.appendChild(postcardBtn);
            }
            cityWallGrid.appendChild(wrap);
        });
        refreshCityWallFeatureActions();
        startCityWallCoverLoader();
        startCityWallWarmQueue();
    }

    function openCityWall() {
        if (!cityWall || cityWall.classList.contains('show')) return;
        // 卡片墙背景不透明，暂停地球渲染，避免其满帧率渲染抢走滚动所需资源
        setGlobeRenderLoop(false);
        if (lightbox.classList.contains('show')) closeLightbox(false);
        if (markerCard.classList.contains('visible')) hideMarkerCard();
        if (cityCard.classList.contains('visible')) hideCityCard(false);
        renderCityWall();
        cityWall.classList.add('show');
        setOverlayHidden(cityWall, false);
        document.body.classList.add('city-wall-open');
        // 与城市图片墙一致：触屏不自动聚焦，避免“返回地球”出现焦点描边
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            cityWallBack.focus();
        }
    }

    function closeCityWall(returnFocus = true) {
        if (!cityWall || !cityWall.classList.contains('show')) return;
        stopCityCardCarousel();
        cityWall.classList.remove('show');
        setOverlayHidden(cityWall, true);
        document.body.classList.remove('city-wall-open');
        // 关掉卡片墙就清掉省份筛选，下次进来看到的是全部城市
        cityWallProvinceFilterName = '';
        renderCityWallProvinceFilter();
        stopCityWallCoverLoader();
        stopCityWallWarmQueue();
        setGlobeRenderLoop(true);
        if (returnFocus) {
            const trigger = cityWallBtn;
            setTimeout(() => {
                if (trigger && trigger.isConnected &&
                    getComputedStyle(trigger).visibility !== 'hidden') {
                    trigger.focus();
                }
            }, 0);
        }
    }

    // ================= 创意功能入口与覆盖层 =================
    // 时间胶囊 / 足迹洞察 / 明信片预览都从城市卡片墙之上打开；
    // 城市卡片墙保持在下一层，关闭新层后回到卡片墙原滚动位置。

    function refreshCityWallFeatureActions() {
        if (cityWallTimeCapsuleBtn) {
            cityWallTimeCapsuleBtn.hidden =
                !featureEnabled('enableTimeCapsule') || timeCapsuleItems().length === 0;
        }
        if (cityWallInsightBtn) {
            cityWallInsightBtn.hidden = !featureEnabled('enableInsight');
        }
    }

    function focusCityWallTop() {
        setTimeout(() => {
            if (cityWallBack && cityWallBack.isConnected &&
                cityWall.classList.contains('show')) {
                cityWallBack.focus();
            }
        }, 260);
    }

    // ---------------- 去年今天 ----------------
    const timeCapsule = document.getElementById('timeCapsule');
    const timeCapsuleBack = document.getElementById('timeCapsuleBack');
    const timeCapsulePrev = document.getElementById('timeCapsulePrev');
    const timeCapsuleNext = document.getElementById('timeCapsuleNext');
    const timeCapsuleStats = document.getElementById('timeCapsuleStats');
    const timeCapsuleBody = document.getElementById('timeCapsuleBody');
    let timeCapsuleItemsCache = [];
    let timeCapsuleIndex = 0;

    function timeCapsuleItems() {
        const now = new Date();
        const today = String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
        return FOOTPRINTS
            .filter(fp => {
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fp.createTime || '');
                if (!m) return false;
                const year = Number(m[1]);
                const md = m[2] + '-' + m[3];
                return year < now.getFullYear() && md === today;
            })
            .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
    }

    function timeCapsuleTicketIndex(fp) {
        const items = ticketItemsFromFootprints();
        const byKey = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
        return byKey >= 0 ? byKey : items.indexOf(fp);
    }

    function renderTimeCapsule() {
        const fp = timeCapsuleItemsCache[timeCapsuleIndex];
        timeCapsuleBody.innerHTML = '';
        timeCapsuleStats.textContent = timeCapsuleItemsCache.length
            ? timeCapsuleItemsCache.length + ' 条历史记录 · 第 ' + (timeCapsuleIndex + 1) + ' 条'
            : '';
        timeCapsulePrev.hidden = timeCapsuleItemsCache.length < 2;
        timeCapsuleNext.hidden = timeCapsuleItemsCache.length < 2;
        if (!fp) {
            timeCapsuleBody.textContent = '今天还没有属于过去的故事';
            return;
        }

        const article = document.createElement('article');
        article.className = 'capsule-card';
        const shot = document.createElement('div');
        shot.className = 'capsule-shot';
        const imgs = cityWallImages(fp);
        if (imgs.length) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = imgs[0].url;
            img.alt = fp.name;
            shot.appendChild(img);
        } else {
            shot.classList.add('no-image');
            shot.textContent = fp.name ? fp.name.charAt(0) : '?';
        }
        article.appendChild(shot);

        const info = document.createElement('div');
        info.className = 'capsule-info';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'capsule-eyebrow';
        eyebrow.textContent = 'FOOTPRINT · ' + (fp.footprintType || '旅行');
        const name = document.createElement('h3');
        name.textContent = fp.name;
        const meta = document.createElement('p');
        meta.className = 'capsule-meta';
        meta.textContent = [fp.city, fp.province, formatCityDate(fp.createTime), fp.address]
            .filter(Boolean).join(' · ');
        const desc = document.createElement('p');
        desc.className = 'capsule-desc';
        desc.textContent = fp.description || '那一天的旅途，被留在了这里。';
        const actions = document.createElement('div');
        actions.className = 'capsule-actions';
        const galleryBtn = document.createElement('button');
        galleryBtn.type = 'button';
        galleryBtn.textContent = '打开图片墙';
        galleryBtn.addEventListener('click', () => {
            const fpIndex = FOOTPRINTS.indexOf(fp);
            const ci = fpIndex >= 0 ? cityList.findIndex(city => city.indices.includes(fpIndex)) : -1;
            closeTimeCapsule(false);
            if (ci >= 0) openCityView(ci, null);
        });
        actions.appendChild(galleryBtn);
        if (ticketImageUrl(fp.ticketImage)) {
            const ticketBtn = document.createElement('button');
            ticketBtn.type = 'button';
            ticketBtn.className = 'is-ticket';
            ticketBtn.textContent = '查看票根';
            ticketBtn.addEventListener('click', () => {
                const idx = timeCapsuleTicketIndex(fp);
                closeTimeCapsule(false);
                closeCityWall(false);
                if (idx >= 0) setTicketView(true, idx, false);
            });
            actions.appendChild(ticketBtn);
        }
        info.append(eyebrow, name, meta, desc, actions);
        article.appendChild(info);
        timeCapsuleBody.appendChild(article);
    }

    function openTimeCapsule() {
        if (!featureEnabled('enableTimeCapsule') || !timeCapsule) return;
        timeCapsuleItemsCache = timeCapsuleItems();
        if (!timeCapsuleItemsCache.length) return;
        timeCapsuleIndex = 0;
        renderTimeCapsule();
        timeCapsule.classList.add('show');
        setOverlayHidden(timeCapsule, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            timeCapsuleBack.focus();
        }
    }

    function closeTimeCapsule(returnFocus = true) {
        if (!timeCapsule || !timeCapsule.classList.contains('show')) return;
        timeCapsule.classList.remove('show');
        setOverlayHidden(timeCapsule, true);
        if (returnFocus) focusCityWallTop();
    }

    // ---------------- 足迹洞察 ----------------
    const insightView = document.getElementById('insightView');
    const insightBack = document.getElementById('insightBack');
    const insightDeck = document.getElementById('insightDeck');
    const insightDots = document.getElementById('insightDots');
    const insightPageCount = document.getElementById('insightPageCount');
    const insightPrevCard = document.getElementById('insightPrevCard');
    const insightNextCard = document.getElementById('insightNextCard');
    const insightTitleEl = document.getElementById('insightTitle');
    let insightCards = [];
    let insightCardIndex = 0;
    let insightSentenceVariant = 0;   // 概览那句总结的说法序号
    let insightYearIndex = 0;         // 年度回顾里选中的年份下标
    let insightSentenceCache = [];    // 概览的几句总结，换说法时只换文字、不重建卡片
    let insightTitleVariant = 0;      // 当前显示第几个称号
    let insightTitleCache = [];       // 已解锁的称号（按稀缺度排），换称号时在这份列表里循环
    const INSIGHT_TITLE_SLOTS = 13;   // 条件称号的总数，用来显示「已解锁 N / 13」

    function haversineKm(a, b) {
        const R = 6371;
        const rad = d => d * Math.PI / 180;
        const dLat = rad(b.lat - a.lat);
        const dLng = rad(b.lng - a.lng);
        const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    // ---- 洞察用的小工具 ----
    function insightSeasonOf(month) {
        if (month >= 3 && month <= 5) return '春';
        if (month >= 6 && month <= 8) return '夏';
        if (month >= 9 && month <= 11) return '秋';
        return '冬';
    }

    function insightMonthOf(fp) {
        const month = Number(String(fp.createTime || '').slice(5, 7));
        return month >= 1 && month <= 12 ? month : 0;
    }

    function insightSpotDate(fp) {
        return fp && fp.createTime ? String(fp.createTime).slice(0, 10).replace(/-/g, '.') : '—';
    }

    function insightKm(value) {
        const n = Math.round(Number(value) || 0);
        return n.toLocaleString('zh-CN');
    }

    function insightPlaceName(fp) {
        return (fp && (fp.city || fp.name)) || '某地';
    }

    // 时间维度：首次 / 最近、跨度、最常出发的月份、连续出行月、12 个月分布
    function insightTimeStats(fps) {
        const dated = fps
            .filter(fp => fp.createTime)
            .slice()
            .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
        if (!dated.length) return null;
        const first = dated[0];
        const last = dated[dated.length - 1];
        const firstTime = new Date(String(first.createTime) + 'T00:00:00').getTime();
        const lastTime = new Date(String(last.createTime) + 'T00:00:00').getTime();
        const spanDays = Number.isFinite(firstTime) && Number.isFinite(lastTime)
            ? Math.max(0, Math.round((lastTime - firstTime) / 86400000))
            : 0;
        const spanYears = Math.floor(spanDays / 365);
        const months = new Array(12).fill(0);
        const monthKeys = new Set();
        dated.forEach(fp => {
            const month = insightMonthOf(fp);
            if (!month) return;
            months[month - 1] += 1;
            const year = Number(String(fp.createTime).slice(0, 4)) || 0;
            monthKeys.add(year * 12 + (month - 1));
        });
        const topMonthCount = Math.max(...months);
        const topMonth = months.indexOf(topMonthCount) + 1;
        // 连续出行月：把「年 * 12 + 月」排成序列，找最长的一段相邻月份
        const keys = [...monthKeys].sort((a, b) => a - b);
        let streak = keys.length ? 1 : 0;
        let best = streak;
        for (let i = 1; i < keys.length; i++) {
            streak = keys[i] === keys[i - 1] + 1 ? streak + 1 : 1;
            best = Math.max(best, streak);
        }
        return {
            first,
            last,
            spanDays,
            spanYears,
            restDays: spanDays - spanYears * 365,
            months,
            topMonth,
            topMonthCount,
            monthCount: keys.length,
            monthStreak: best
        };
    }

    // 省份维度：每个省去过多少座城市、留下多少条足迹
    function insightProvinceStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const name = String(fp.province || '').trim();
            if (!name) return;
            if (!map.has(name)) map.set(name, { name, footprints: 0, cities: new Set() });
            const item = map.get(name);
            item.footprints += 1;
            if (fp.city) item.cities.add(fp.city);
        });
        const list = [...map.values()]
            .map(item => ({ name: item.name, footprints: item.footprints, cities: item.cities.size }))
            .sort((a, b) => b.footprints - a.footprints ||
                b.cities - a.cities ||
                a.name.localeCompare(b.name, 'zh-Hans-CN'));
        return { list, total: list.length };
    }

    // 单段之最：按时间相邻的两条足迹算一段，取最长 / 最短 / 平均与四个方向极值
    function insightSegmentStats(fps) {
        const located = fps.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
        const dated = located
            .filter(fp => fp.createTime)
            .slice()
            .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
        const segments = [];
        for (let i = 1; i < dated.length; i++) {
            const km = haversineKm(dated[i - 1], dated[i]);
            if (Number.isFinite(km)) segments.push({ from: dated[i - 1], to: dated[i], km });
        }
        const byKm = segments.slice().sort((a, b) => b.km - a.km);
        const byLat = located.slice().sort((a, b) => a.lat - b.lat);
        const byLng = located.slice().sort((a, b) => a.lng - b.lng);
        const totalKm = segments.reduce((sum, item) => sum + item.km, 0);
        return {
            count: segments.length,
            longest: byKm[0] || null,
            shortest: byKm[byKm.length - 1] || null,
            average: segments.length ? totalKm / segments.length : 0,
            totalKm,
            south: byLat[0] || null,
            north: byLat[byLat.length - 1] || null,
            west: byLng[0] || null,
            east: byLng[byLng.length - 1] || null
        };
    }

    // 类型维度：每种类型多少次，以及它最常出现在哪个季节
    function insightTypeStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const name = String(fp.footprintType || '').trim() || '旅行';
            if (!map.has(name)) map.set(name, { name, count: 0, seasons: { 春: 0, 夏: 0, 秋: 0, 冬: 0 } });
            const item = map.get(name);
            item.count += 1;
            const month = insightMonthOf(fp);
            if (month) item.seasons[insightSeasonOf(month)] += 1;
        });
        const list = [...map.values()].map(item => {
            const top = Object.entries(item.seasons).sort((a, b) => b[1] - a[1])[0] || ['', 0];
            return {
                name: item.name,
                count: item.count,
                season: top[1] ? top[0] : '',
                seasonCount: top[1] || 0
            };
        }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
        return { list };
    }

    // 年度回顾：按年份聚合，倒序排列
    function insightYearStats(fps) {
        const map = new Map();
        fps.forEach(fp => {
            const year = String(fp.createTime || '').slice(0, 4);
            if (!/^\d{4}$/.test(year)) return;
            if (!map.has(year)) map.set(year, []);
            map.get(year).push(fp);
        });
        return [...map.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([year, items]) => {
                const dated = items
                    .filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng))
                    .slice()
                    .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)));
                let km = 0;
                for (let i = 1; i < dated.length; i++) km += haversineKm(dated[i - 1], dated[i]);
                const seasons = [...new Set(items
                    .map(fp => insightMonthOf(fp))
                    .filter(Boolean)
                    .map(insightSeasonOf))];
                return {
                    year,
                    footprints: items.length,
                    cities: new Set(items.map(fp => fp.city).filter(Boolean)).size,
                    provinces: [...new Set(items.map(fp => String(fp.province || '').trim()).filter(Boolean))],
                    photos: items.reduce((n, fp) => n + cityWallImages(fp).length, 0),
                    tickets: items.filter(fp => ticketImageUrl(fp.ticketImage)).length,
                    km: Math.round(km),
                    months: new Set(items.map(fp => String(fp.createTime || '').slice(5, 7)).filter(Boolean)).size,
                    seasons
                };
            });
    }

    // 票根收藏家的判定只有这一处：称号和徽章共用，免得同名两个门槛，
    // 出现「顶栏自称票根收藏家，下面那枚徽章却还灰着」
    function insightTicketCollectorDone(m) {
        return m.footprintCount > 0 && m.ticketCount * 2 >= m.footprintCount;
    }

    // 周末：createTime 被统一成 YYYY-MM-DD，小时已经丢了，只能算到「星期」这一层
    function insightIsWeekend(fp) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((fp && fp.createTime) || ''));
        if (!m) return false;
        const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
        return day === 0 || day === 6;
    }

    // 成就与称号共用的派生统计：只算一遍，两边都从这里取，免得口径漂移
    function insightDerived(segment) {
        const located = FOOTPRINTS.filter(fp => Number.isFinite(fp.lat) && Number.isFinite(fp.lng));
        const byLat = located.slice().sort((a, b) => a.lat - b.lat);
        const byLng = located.slice().sort((a, b) => a.lng - b.lng);
        const maxCityVisits = cityList.reduce((max, city, ci) => Math.max(max, cityViewItems(ci).length), 0);
        let repeatCities = 0;
        cityList.forEach((city, ci) => {
            if (cityViewItems(ci).length >= 2) repeatCities += 1;
        });
        const ticketedCityKeys = new Set(FOOTPRINTS
            .filter(fp => ticketImageUrl(fp.ticketImage))
            .map(fp => cityKeyOf(fp)));
        return {
            north: byLat[byLat.length - 1] || null,
            south: byLat[0] || null,
            east: byLng[byLng.length - 1] || null,
            west: byLng[0] || null,
            // 只有一条数据时跨度按 0 算，免得「跨越 0.0 个纬度」也算点亮
            latSpan: byLat.length >= 2 ? byLat[byLat.length - 1].lat - byLat[0].lat : 0,
            lngSpan: byLng.length >= 2 ? byLng[byLng.length - 1].lng - byLng[0].lng : 0,
            yearCount: new Set(FOOTPRINTS
                .map(fp => String(fp.createTime || '').slice(0, 4))
                .filter(year => /^\d{4}$/.test(year))).size,
            seasonCount: new Set(FOOTPRINTS
                .map(fp => insightMonthOf(fp))
                .filter(Boolean)
                .map(insightSeasonOf)).size,
            maxCityVisits,
            repeatCities,
            photos: FOOTPRINTS.reduce((n, fp) => n + cityWallImages(fp).length, 0),
            weekendCount: FOOTPRINTS.filter(insightIsWeekend).length,
            // 画廊是「一条足迹带多张图」，所以这里比 cityWallImages 的 1 张兜底要严
            galleryCount: FOOTPRINTS.filter(fp => cityWallImages(fp).length >= 2).length,
            articleCount: FOOTPRINTS.filter(fp => String(fp.article || '').trim()).length,
            typeCount: new Set(FOOTPRINTS
                .map(fp => String(fp.footprintType || '').trim() || '旅行')).size,
            // 「一城一票」：所有城市都能翻出票根。城市太少不算数，免得点亮得太容易
            unticketedCities: cityList.filter(city => !ticketedCityKeys.has(city.key)).length,
            allCitiesTicketed: cityList.length >= 3 &&
                cityList.every(city => ticketedCityKeys.has(city.key)),
            longest: segment && segment.longest ? segment.longest.km : 0
        };
    }

    // 轻成就：全部用已有数据算，满足条件即点亮。
    // 未点亮的补一句 remaining（还差多少），显示在进度位置
    function insightAchievements(m, time, province, segment, stats) {
        const s = stats || insightDerived(segment);
        const ticketHalf = Math.ceil(m.footprintCount / 2);
        const ticketGap = Math.max(0, ticketHalf - m.ticketCount);
        return [
            {
                name: '跨省旅人',
                desc: '点亮 3 个以上省份',
                done: province.total >= 3,
                progress: province.total + ' 个省',
                remaining: '还差 ' + Math.max(0, 3 - province.total) + ' 个省'
            },
            {
                name: '疆域辽阔',
                desc: '到访 8 个省份以上',
                done: province.total >= 8,
                progress: province.total + ' 个省',
                remaining: '还差 ' + Math.max(0, 8 - province.total) + ' 个省'
            },
            {
                name: '南北纵贯',
                desc: '最北与最南相隔 8 度以上',
                done: s.latSpan >= 8,
                progress: s.latSpan ? s.latSpan.toFixed(1) + ' 度' : '暂无数据',
                remaining: s.latSpan ? '还差 ' + Math.max(0, 8 - s.latSpan).toFixed(1) + ' 度' : '暂无数据'
            },
            {
                name: '北境行者',
                desc: '最北的足迹在北纬 40° 以上',
                done: !!s.north && s.north.lat >= 40,
                progress: s.north ? '北纬 ' + s.north.lat.toFixed(1) + '°' : '暂无数据',
                remaining: s.north
                    ? '最北北纬 ' + s.north.lat.toFixed(1) + '°，还差 ' +
                        Math.max(0, 40 - s.north.lat).toFixed(1) + ' 度'
                    : '暂无数据'
            },
            {
                name: '经度猎手',
                desc: '最东与最西相隔 10 度以上',
                done: s.lngSpan >= 10,
                progress: s.lngSpan ? s.lngSpan.toFixed(1) + ' 度' : '暂无数据',
                remaining: s.lngSpan ? '还差 ' + Math.max(0, 10 - s.lngSpan).toFixed(1) + ' 度' : '暂无数据'
            },
            {
                name: '长途跋涉',
                desc: '单段行程超过 500 公里',
                done: s.longest >= 500,
                progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
                remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 500 - s.longest)) + ' km' : '暂无数据'
            },
            {
                name: '千里单骑',
                desc: '单段行程超过 1000 公里',
                done: s.longest >= 1000,
                progress: s.longest ? insightKm(s.longest) + ' km' : '暂无数据',
                remaining: s.longest ? '还差 ' + insightKm(Math.max(0, 1000 - s.longest)) + ' km' : '暂无数据'
            },
            {
                name: '票根收藏家',
                desc: '一半以上的足迹有票根',
                done: insightTicketCollectorDone(m),
                progress: m.ticketCount + '/' + m.footprintCount,
                remaining: m.footprintCount ? '还差 ' + ticketGap + ' 张（要 ' + ticketHalf + ' 张）' : '暂无数据'
            },
            {
                name: '票根大户',
                desc: '累计票根 20 张以上',
                done: m.ticketCount >= 20,
                progress: m.ticketCount + ' 张',
                remaining: '还差 ' + Math.max(0, 20 - m.ticketCount) + ' 张'
            },
            {
                name: '跨年旅人',
                desc: '在两个以上年份出发',
                done: s.yearCount >= 2,
                progress: s.yearCount + ' 个年份',
                remaining: '还差 ' + Math.max(0, 2 - s.yearCount) + ' 个年份'
            },
            {
                name: '岁月留痕',
                desc: '记录跨度 3 年以上',
                done: !!time && time.spanYears >= 3,
                progress: time ? time.spanYears + ' 年' : '暂无数据',
                remaining: time ? '还差 ' + Math.max(0, 3 - time.spanYears) + ' 年' : '暂无数据'
            },
            {
                name: '同城三刷',
                desc: '同一座城市去过 3 次以上',
                done: s.maxCityVisits >= 3,
                progress: '最多 ' + s.maxCityVisits + ' 次',
                remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 3 - s.maxCityVisits) + ' 次'
            },
            {
                name: '单城五刷',
                desc: '同一座城市去过 5 次以上',
                done: s.maxCityVisits >= 5,
                progress: '最多 ' + s.maxCityVisits + ' 次',
                remaining: '最多 ' + s.maxCityVisits + ' 次，还差 ' + Math.max(0, 5 - s.maxCityVisits) + ' 次'
            },
            {
                name: '回头客',
                desc: '有 5 座城市去过两次以上',
                done: s.repeatCities >= 5,
                progress: s.repeatCities + ' 座城市',
                remaining: '还差 ' + Math.max(0, 5 - s.repeatCities) + ' 座'
            },
            {
                name: '相册达人',
                desc: '累计收录 100 张以上照片',
                done: s.photos >= 100,
                progress: s.photos + ' 张',
                remaining: '还差 ' + Math.max(0, 100 - s.photos) + ' 张'
            },
            {
                name: '快门狂魔',
                desc: '累计收录 500 张以上照片',
                done: s.photos >= 500,
                progress: s.photos + ' 张',
                remaining: '还差 ' + Math.max(0, 500 - s.photos) + ' 张'
            },
            {
                name: '画廊主人',
                desc: '3 条足迹带多图画廊',
                done: s.galleryCount >= 3,
                progress: s.galleryCount + ' 条',
                remaining: '还差 ' + Math.max(0, 3 - s.galleryCount) + ' 条'
            },
            {
                name: '图文并茂',
                desc: '5 条足迹挂了文章链接',
                done: s.articleCount >= 5,
                progress: s.articleCount + ' 条',
                remaining: '还差 ' + Math.max(0, 5 - s.articleCount) + ' 条'
            },
            {
                name: '一城一票',
                desc: '每座城市都留下了票根',
                done: s.allCitiesTicketed,
                progress: '票根覆盖 ' + (cityList.length - s.unticketedCities) + '/' + cityList.length + ' 座城市',
                remaining: cityList.length < 3
                    ? '至少 3 座城市后解锁'
                    : '还有 ' + s.unticketedCities + ' 座城市没票根'
            },
            {
                name: '四季出行',
                desc: '春夏秋冬都出发过',
                done: s.seasonCount >= 4,
                progress: s.seasonCount + ' 个季节',
                remaining: '还差 ' + Math.max(0, 4 - s.seasonCount) + ' 个季节'
            },
            {
                name: '月度常客',
                desc: '累计在 10 个不同月份出发过',
                done: !!time && time.monthCount >= 10,
                progress: time ? time.monthCount + ' 个月份' : '暂无数据',
                remaining: time ? '还差 ' + Math.max(0, 10 - time.monthCount) + ' 个月份' : '暂无数据'
            },
            {
                name: '周末出走',
                desc: '5 次以上出发落在周末',
                done: s.weekendCount >= 5,
                progress: s.weekendCount + ' 次',
                remaining: '还差 ' + Math.max(0, 5 - s.weekendCount) + ' 次'
            },
            {
                name: '万里行者',
                desc: '累计里程 1 万公里以上',
                done: m.distanceKm >= 10000,
                progress: insightKm(m.distanceKm) + ' km',
                remaining: '还差 ' + insightKm(Math.max(0, 10000 - m.distanceKm)) + ' km'
            },
            {
                name: '主题收藏家',
                desc: '主题类型 5 种以上',
                done: s.typeCount >= 5,
                progress: s.typeCount + ' 种',
                remaining: '还差 ' + Math.max(0, 5 - s.typeCount) + ' 种'
            }
        ];
    }

    // 称号：把所有已解锁的收集出来（顺序 = 稀缺度，从难到易）。
    // 第一句默认显示，成就卡上的「换一个称号」就在这份列表里循环，所以不再只挑一句。
    function insightTitlesOf(m, time, province, segment, stats) {
        const s = stats || insightDerived(segment);
        const list = [];
        if (m.cityCount >= 30) list.push('百城 · 点亮 ' + m.cityCount + ' 座城市');
        if (m.distanceKm >= 10000) list.push('万里行者 · 约 ' + insightKm(m.distanceKm) + ' 公里');
        if (s.photos >= 500) list.push('快门收藏家 · 收下 ' + s.photos + ' 张照片');
        if (s.lngSpan >= 20) list.push('东西横穿者 · 跨越 ' + s.lngSpan.toFixed(1) + ' 个经度');
        if (s.latSpan >= 12) list.push('南北纵贯者 · 跨越 ' + s.latSpan.toFixed(1) + ' 个纬度');
        if (s.repeatCities >= 5) list.push('老地方收集者 · ' + s.repeatCities + ' 座城市去过两次以上');
        if (time && time.spanYears >= 3) list.push('常年旅人 · 记录横跨 ' + time.spanYears + ' 年');
        if (province.total >= 10) list.push('远行者 · 走过 ' + province.total + ' 个省份');
        if (province.total >= 8) list.push('疆域辽阔者 · 走过 ' + province.total + ' 个省份');
        if (insightTicketCollectorDone(m)) list.push('票根收藏家 · 攒下 ' + m.ticketCount + ' 张票根');
        if (m.cityCount >= 10) list.push('城市收集者 · 点亮 ' + m.cityCount + ' 座城市');
        if (s.weekendCount >= 10) list.push('周末出走者 · ' + s.weekendCount + ' 次出发落在周末');
        if (time && time.monthStreak >= 3) list.push('四季旅人 · 连续 ' + time.monthStreak + ' 个月出发');
        return list;
    }

    // 一句条件称号都没解锁时的兜底，不算进「N / 13」
    function insightFallbackTitle(m) {
        return '刚出发的旅人 · ' + m.footprintCount + ' 段旅程';
    }

    // 还是保留「给一个最贴切的」这个入口，给需要单句的地方用
    function insightTitleOf(m, time, province, segment, stats) {
        const list = insightTitlesOf(m, time, province, segment, stats);
        return list.length ? list[0] : insightFallbackTitle(m);
    }

    function insightMetrics() {
        const fps = FOOTPRINTS.filter(fp => fp.lat && fp.lng);
        const sorted = fps.slice().sort((a, b) =>
            String(a.createTime || '').localeCompare(String(b.createTime || '')));
        const distance = sorted.slice(1).reduce((sum, fp, i) =>
            sum + haversineKm(sorted[i], fp), 0);
        const months = fps.map(fp => Number(String(fp.createTime || '').slice(5, 7))).filter(Boolean);
        const seasonCount = { 春: 0, 夏: 0, 秋: 0, 冬: 0 };
        months.forEach(m => {
            if (m >= 3 && m <= 5) seasonCount['春']++;
            else if (m >= 6 && m <= 8) seasonCount['夏']++;
            else if (m >= 9 && m <= 11) seasonCount['秋']++;
            else seasonCount['冬']++;
        });
        const topSeason = Object.entries(seasonCount).sort((a, b) => b[1] - a[1])[0];
        const typeCount = {};
        fps.forEach(fp => {
            const t = fp.footprintType || '旅行';
            typeCount[t] = (typeCount[t] || 0) + 1;
        });
        const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
        const byLat = [...fps].sort((a, b) => a.lat - b.lat);
        const byLng = [...fps].sort((a, b) => a.lng - b.lng);
        return {
            footprintCount: FOOTPRINTS.length,
            cityCount: cityList.length,
            // 足迹洞察看的是全部数据：这里不能用 ticketItemsFromFootprints()，
            // 它认票根页的「只看某座城市」筛选，会把概览的票根数和票根收藏家一起算少
            ticketCount: FOOTPRINTS.filter(fp => ticketImageUrl(fp.ticketImage)).length,
            photoCount: FOOTPRINTS.reduce((n, fp) => n + cityWallImages(fp).length, 0),
            distanceKm: Math.round(distance),
            topSeason: topSeason && topSeason[1] ? topSeason[0] : '',
            topSeasonCount: topSeason ? topSeason[1] : 0,
            topType: topType && topType[1] ? topType[0] : '',
            topTypeCount: topType ? topType[1] : 0,
            south: byLat[0], north: byLat[byLat.length - 1],
            west: byLng[0], east: byLng[byLng.length - 1]
        };
    }

    // 概览卡的几句总结：数据是真的，语气留一点文艺。
    // 说法大致按「总览 → 节奏 → 地理 → 偏爱 → 距离 → 收藏 → 年份 → 称号」铺开，
    // 缺哪块数据就跳过哪句：「换一个说法」在数据齐全时能翻二十来次，数据少时也不会露出空话。
    // 第 1 句保持任何数据都成立，打开洞察时默认显示的就是它。
    function insightSentences(m, time, province, segment, extras = {}) {
        const years = extras.years || [];
        const title = extras.title || '';
        const longest = segment && segment.longest;
        const list = [];
        list.push('约 ' + m.footprintCount + ' 次出发、' + m.cityCount +
            ' 座城市，地图上的每一处坐标都是一个故事。');
        if (m.distanceKm) {
            list.push(m.cityCount + ' 座城市、约 ' + m.distanceKm.toLocaleString('zh-CN') +
                ' 公里的路，是你一步一步走出来的版图。');
        }
        list.push((m.topSeason ? '你似乎总在' + m.topSeason + '天收拾行囊，' : '你总在合适的时候出发，') +
            (m.topType ? '「' + m.topType + '」是你写得最多的一页。' : '每一程都值得被记住。'));

        // 节奏：平均多久出发一次。密一点说「熟练」，疏一点说「算数」
        if (time && m.footprintCount >= 3) {
            const gapDays = Math.round(time.spanDays / (m.footprintCount - 1));
            if (gapDays > 0) {
                list.push(m.footprintCount + ' 次出发散在 ' + time.monthCount + ' 个月里，平均每 ' + gapDays +
                    (gapDays <= 60
                        ? ' 天就收拾一次行李 —— 出发这件事，你早就做得很熟练。'
                        : ' 天才动身一回 —— 不算频繁，但每一次都算数。'));
            }
        }
        if (time && time.monthStreak >= 3) {
            list.push('最长的一段，你连着 ' + time.monthStreak +
                ' 个月都在路上 —— 那段时间，行李箱大概一直没收起来过。');
        }
        if (time && time.topMonthCount >= 2) {
            list.push(time.topMonth + ' 月是你的高发期，前后一共出发了 ' + time.topMonthCount +
                ' 次，那个月份的风，你大概最熟悉。');
        }
        if (m.topSeason && m.topSeasonCount >= 2) {
            list.push(m.topSeason + '季是你最常选中的时节，' + m.topSeasonCount + ' 次出发落在了那里。');
        }

        if (province && province.total) {
            list.push(province.total + ' 个省份里，' + province.list[0].name +
                '被你翻开的次数最多 —— 那里大概有值得反复抵达的理由。');
        }
        // 地理跨度：纬度看南北，经度看东西
        const latSpan = m.south && m.north ? Math.abs(m.north.lat - m.south.lat) : 0;
        if (latSpan >= 3) {
            list.push('从最南的 ' + insightPlaceName(m.south) + ' 到最北的 ' + insightPlaceName(m.north) +
                '，你把 ' + latSpan.toFixed(1) + ' 个纬度装进了自己的地图。');
        } else if (!province.total && m.south && m.north &&
            insightPlaceName(m.south) !== insightPlaceName(m.north)) {
            list.push('从 ' + insightPlaceName(m.south) + ' 到 ' + insightPlaceName(m.north) +
                '，世界在地图上被你慢慢点亮。');
        }
        if (m.west && m.east) {
            const lngSpan = Math.abs(m.east.lng - m.west.lng);
            if (lngSpan >= 3) {
                list.push('最东是 ' + insightPlaceName(m.east) + '，最西是 ' + insightPlaceName(m.west) +
                    '，中间隔着 ' + lngSpan.toFixed(1) + ' 个经度 —— 那是你横向丈量世界的方式。');
            }
        }

        // 偏爱：回去得最多的那座城市，以及所有被重复抵达过的城市
        let topCityName = '';
        let topCityVisits = 0;
        let repeatCities = 0;
        cityList.forEach((city, ci) => {
            const visits = cityViewItems(ci).length;
            if (visits >= 2) repeatCities += 1;
            if (visits > topCityVisits) {
                topCityVisits = visits;
                topCityName = city.city || '';
            }
        });
        if (topCityName && topCityVisits >= 2) {
            list.push('在 ' + m.cityCount + ' 座城市里，' + topCityName + ' 是你回去最多的地方（' +
                topCityVisits + ' 次），有些地方就是值得反复抵达。');
        }
        if (repeatCities >= 2) {
            list.push('有 ' + repeatCities + ' 座城市你去过两次以上，它们大概更像「老地方」。');
        }

        if (longest) {
            list.push('走得最远的一次，是从' + insightPlaceName(longest.from) + '到' +
                insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。');
        }
        if (segment && segment.count >= 2 && segment.average > 0) {
            list.push('平均每一段约 ' + insightKm(segment.average) +
                ' 公里，步子不算大，但一直没有停下来过。');
        }

        // 收藏：照片和票根都有就合起来说，只有一样时只说那一样
        if (m.ticketCount && m.photoCount) {
            list.push(m.photoCount + ' 张照片、' + m.ticketCount +
                ' 张票根，你不仅出发，也把它们都妥帖地留了下来。');
        } else {
            list.push(m.ticketCount
                ? '你还留下了 ' + m.ticketCount + ' 张票根，每一次出发都被妥帖地收着。'
                : m.photoCount + ' 张照片被好好收着，' +
                    (m.photoCount > 1 ? '它们替你说着' : '它替你说着') + '当时的光线与心情。');
        }
        if (m.photoCount - m.footprintCount >= 2) {
            list.push('照片比足迹多出 ' + (m.photoCount - m.footprintCount) +
                ' 张 —— 有些地方，你显然舍不得只拍一张。');
        }

        if (time && time.spanDays > 0) {
            list.push('从 ' + insightSpotDate(time.first) + ' 到 ' + insightSpotDate(time.last) + '，' +
                (time.spanYears > 0
                    ? time.spanYears + ' 年 ' + time.restDays + ' 天'
                    : time.spanDays + ' 天') +
                '的光阴，被你拆成了 ' + time.monthCount + ' 个月的出发。');
        }
        if (years.length >= 2) {
            const busiest = years.reduce((best, item) =>
                item.footprints > best.footprints ? item : best, years[0]);
            list.push(busiest.year + ' 年是你出发最多的一年，一共 ' + busiest.footprints +
                ' 次，那一年你把地图铺得最开。');
        }
        if (title) {
            list.push('按现在的记录，你担得起「' + title + '」—— 这不是标签，是你自己走出来的。');
        }
        return list.length ? list : ['还没有足迹数据，出发后回来看看你的旅行洞察。'];
    }

    // ---- 洞察卡：数据 -> DOM ----
    function insightMetric(label, value, opts = {}) {
        return { label, value, hint: opts.hint || '', action: opts.action || null };
    }

    function insightMetricsDom(items, id) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-metrics';
        if (id) wrap.id = id;
        items.forEach(item => {
            const node = document.createElement(item.action ? 'button' : 'div');
            node.className = 'insight-metric' + (item.action ? ' is-link' : '');
            if (item.action) {
                node.type = 'button';
                node.addEventListener('click', item.action);
            }
            const label = document.createElement('span');
            label.className = 'insight-metric-label';
            label.textContent = item.label;
            const value = document.createElement('strong');
            value.className = 'insight-metric-value';
            value.textContent = item.value;
            node.append(label, value);
            if (item.hint) {
                const hint = document.createElement('em');
                hint.className = 'insight-metric-hint';
                hint.textContent = item.hint;
                node.appendChild(hint);
            }
            wrap.appendChild(node);
        });
        return wrap;
    }

    // 12 个月分布条
    function insightMonthsDom(months) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-months';
        wrap.setAttribute('aria-hidden', 'true');
        const max = Math.max(1, ...months);
        months.forEach((count, i) => {
            const col = document.createElement('div');
            col.className = 'insight-month' +
                (count && count === max ? ' is-top' : '') +
                (count ? '' : ' is-empty');
            col.title = (i + 1) + ' 月 · ' + count + ' 次';
            const bar = document.createElement('span');
            bar.className = 'insight-month-bar';
            bar.style.setProperty('--month-ratio', String(count / max));
            const label = document.createElement('em');
            label.textContent = String(i + 1);
            col.append(bar, label);
            wrap.appendChild(col);
        });
        return wrap;
    }

    function insightChipsDom(chips) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-chips';
        chips.forEach(chip => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'insight-chip' + (chip.className ? ' ' + chip.className : '') +
                (chip.active ? ' is-active' : '');
            btn.textContent = chip.text;
            btn.setAttribute('aria-pressed', chip.active ? 'true' : 'false');
            btn.addEventListener('click', chip.onClick);
            wrap.appendChild(btn);
        });
        return wrap;
    }

    function insightBadgesDom(badges) {
        const wrap = document.createElement('div');
        wrap.className = 'insight-badges';
        badges.forEach(item => {
            const row = document.createElement('div');
            row.className = 'insight-badge' + (item.done ? ' is-earned' : ' is-locked');
            const mark = document.createElement('span');
            mark.className = 'insight-badge-mark';
            mark.textContent = item.done ? '✓' : '·';
            const text = document.createElement('span');
            text.className = 'insight-badge-text';
            const name = document.createElement('strong');
            name.textContent = item.name;
            const desc = document.createElement('em');
            // 已点亮的给结果值（12 个省），没点亮的给「还差多少」——
            // 只写 6/24 的话得自己算还差几张
            const detail = item.done ? item.progress : (item.remaining || item.progress);
            desc.textContent = item.desc + (detail ? ' · ' + detail : '');
            text.append(name, desc);
            row.append(mark, text);
            wrap.appendChild(row);
        });
        return wrap;
    }

    function insightCardDom(card) {
        const section = document.createElement('section');
        section.className = 'insight-card';
        section.dataset.cardId = card.id;
        section.setAttribute('role', 'tabpanel');
        const kicker = document.createElement('p');
        kicker.className = 'insight-kicker';
        kicker.textContent = card.kicker;
        const headline = document.createElement('h3');
        headline.className = 'insight-headline';
        if (card.headlineId) headline.id = card.headlineId;
        headline.textContent = card.headline;
        section.append(kicker, headline);
        if (card.note) {
            const note = document.createElement('p');
            note.className = 'insight-card-note';
            note.textContent = card.note;
            section.appendChild(note);
        }
        if (card.chips && card.chips.length) section.appendChild(insightChipsDom(card.chips));
        if (card.months) section.appendChild(insightMonthsDom(card.months));
        if (card.metrics && card.metrics.length) section.appendChild(insightMetricsDom(card.metrics, card.metricsId));
        if (card.badges && card.badges.length) section.appendChild(insightBadgesDom(card.badges));
        return section;
    }

    function insightYearHeadline(item) {
        return item.year + ' 年 · ' + item.footprints + ' 次出发、' + item.cities + ' 座城市' +
            (item.km ? '，约 ' + insightKm(item.km) + ' 公里' : '') + '。';
    }

    function insightYearMetrics(item) {
        return [
            insightMetric('足迹', item.footprints + ' 次'),
            insightMetric('城市', item.cities + ' 座'),
            insightMetric('省份', item.provinces.length + ' 个'),
            insightMetric('照片', item.photos + ' 张'),
            insightMetric('票根', item.tickets + ' 张'),
            insightMetric('估算里程', item.km ? insightKm(item.km) + ' km' : '—'),
            insightMetric('到访月份', item.months + ' 个月'),
            insightMetric('到访季节', item.seasons.join('、') || '—')
        ];
    }

    function refreshInsightYearCard(index) {
        const years = insightYearStats(FOOTPRINTS);
        if (!years.length) return;
        insightYearIndex = Math.max(0, Math.min(index, years.length - 1));
        const active = years[insightYearIndex];
        const headline = document.getElementById('insightYearHeadline');
        if (headline) headline.textContent = insightYearHeadline(active);
        const metrics = document.getElementById('insightYearMetrics');
        if (metrics) metrics.replaceWith(insightMetricsDom(insightYearMetrics(active), 'insightYearMetrics'));
        if (!insightDeck) return;
        [...insightDeck.querySelectorAll('.insight-year-chip')].forEach((chip, i) => {
            chip.classList.toggle('is-active', i === insightYearIndex);
            chip.setAttribute('aria-pressed', i === insightYearIndex ? 'true' : 'false');
        });
    }

    // 只换概览那句话，下面那张统计表保持原样：
    // 以前是整张卡重建，统计表会跟着重放一次淡入动画
    function swapInsightSentence() {
        if (!insightSentenceCache.length) return;
        insightSentenceVariant = (insightSentenceVariant + 1) % insightSentenceCache.length;
        const node = document.getElementById('insightOverviewHeadline');
        if (!node) return;
        node.classList.remove('is-swapping');
        void node.offsetWidth;   // 触发重排，让动画能重新播
        node.textContent = insightSentenceCache[insightSentenceVariant];
        node.classList.add('is-swapping');
    }

    // 换一个称号：只改成就卡那句和顶栏副标题，徽章表与卡片结构都不动。
    // 称号在两个地方同时出现，所以必须一起更新，不然顶栏和卡里会对不上
    function swapInsightTitle() {
        if (insightTitleCache.length < 2) return;
        insightTitleVariant = (insightTitleVariant + 1) % insightTitleCache.length;
        const next = insightTitleCache[insightTitleVariant];
        const node = document.getElementById('insightBadgeHeadline');
        if (node) {
            node.classList.remove('is-swapping');
            void node.offsetWidth;   // 触发重排，让动画能重新播
            node.textContent = '「' + next + '」';
            node.classList.add('is-swapping');
        }
        if (insightTitleEl) insightTitleEl.textContent = next;
    }

    // 点数字直达对应内容：票根墙 / 某座城市 / 某省
    function insightOpenTicketWall() {
        closeInsight(false);
        setTicketView(true);
    }

    function insightOpenCity(cityName) {
        const ci = cityList.findIndex(city => city.city === cityName);
        if (ci < 0) return;
        closeInsight(false);
        openCityView(ci, null);
    }

    function insightFilterProvince(name) {
        if (!name) return;
        closeInsight(false);
        setCityWallProvinceFilter(name);
    }

    function insightCardsData() {
        const m = insightMetrics();
        const time = insightTimeStats(FOOTPRINTS);
        const province = insightProvinceStats(FOOTPRINTS);
        const segment = insightSegmentStats(FOOTPRINTS);
        const type = insightTypeStats(FOOTPRINTS);
        const years = insightYearStats(FOOTPRINTS);
        const derived = insightDerived(segment);
        const badges = insightAchievements(m, time, province, segment, derived);
        const titles = insightTitlesOf(m, time, province, segment, derived);
        insightTitleCache = titles;
        if (insightTitleVariant >= titles.length) insightTitleVariant = 0;
        const title = titles.length
            ? titles[insightTitleVariant % titles.length]
            : insightFallbackTitle(m);
        if (!FOOTPRINTS.length) {
            return {
                title: '',
                cards: [{
                    id: 'empty',
                    kicker: 'TRAVEL SUMMARY',
                    headline: '还没有足迹数据，出发后回来看看你的旅行洞察。',
                    metrics: []
                }]
            };
        }
        const sentences = insightSentences(m, time, province, segment, { years, title });
        insightSentenceCache = sentences;
        if (insightSentenceVariant >= sentences.length) insightSentenceVariant = 0;
        const cards = [];

        // 1. 概览
        cards.push({
            id: 'overview',
            kicker: 'TRAVEL SUMMARY',
            headlineId: 'insightOverviewHeadline',
            headline: sentences[insightSentenceVariant % sentences.length],
            chips: [{
                text: '换一个说法',
                onClick: swapInsightSentence
            }],
            metrics: [
                insightMetric('足迹', m.footprintCount + ' 次', { action: () => closeInsight() }),
                insightMetric('城市', m.cityCount + ' 座', { action: () => closeInsight() }),
                insightMetric('票根', m.ticketCount + ' 张', { action: insightOpenTicketWall }),
                insightMetric('照片', m.photoCount + ' 张'),
                insightMetric('估算里程', m.distanceKm ? m.distanceKm.toLocaleString('zh-CN') + ' km' : '—'),
                insightMetric('出发季节', m.topSeason ? m.topSeason + '（' + m.topSeasonCount + ' 次）' : '—')
            ]
        });

        // 2. 时间
        if (time) {
            const spanText = time.spanYears > 0
                ? time.spanYears + ' 年 ' + time.restDays + ' 天'
                : time.spanDays + ' 天';
            cards.push({
                id: 'time',
                kicker: 'TIMELINE · 时间',
                headline: '第一次出发是在 ' + insightSpotDate(time.first) + ' 的' +
                    insightPlaceName(time.first) + '，最近一次停在 ' + insightSpotDate(time.last) + ' 的' +
                    insightPlaceName(time.last) + ' —— 这条路，你走了 ' + spanText + '。',
                months: time.months,
                metrics: [
                    insightMetric('首次出发', insightSpotDate(time.first), { hint: insightPlaceName(time.first) }),
                    insightMetric('最近一次', insightSpotDate(time.last), { hint: insightPlaceName(time.last) }),
                    insightMetric('最常出发的月份', time.topMonth + ' 月 · ' + time.topMonthCount + ' 次'),
                    insightMetric('出行过的月份', time.monthCount + ' 个月'),
                    insightMetric('最长连续出行', time.monthStreak + ' 个月'),
                    insightMetric('旅行跨度', spanText)
                ]
            });
        }

        // 3. 省份：点某个省 → 回到卡片墙并只看这个省
        if (province.total) {
            cards.push({
                id: 'province',
                kicker: 'PROVINCES · 省份',
                headline: province.total + ' 个省份、' + m.cityCount + ' 座城市，' +
                    province.list[0].name + '留下了你最多的脚印。',
                metrics: province.list.slice(0, 9).map(item => insightMetric(
                    item.name,
                    item.cities + ' 座城市 · ' + item.footprints + ' 个足迹',
                    { action: () => insightFilterProvince(item.name) }
                ))
            });
        }

        // 4. 距离与方位：点城市进对应图片墙
        if (segment.count) {
            const longest = segment.longest;
            const shortest = segment.shortest;
            cards.push({
                id: 'segment',
                kicker: 'DISTANCE · 距离',
                headline: '最长的一次远行，是从' + insightPlaceName(longest.from) + '到' +
                    insightPlaceName(longest.to) + '，约 ' + insightKm(longest.km) + ' 公里。',
                metrics: [
                    insightMetric('最长一段', insightKm(longest.km) + ' km', {
                        hint: insightPlaceName(longest.from) + ' → ' + insightPlaceName(longest.to),
                        action: () => insightOpenCity(longest.to.city)
                    }),
                    insightMetric('最短一段', insightKm(shortest.km) + ' km', {
                        hint: insightPlaceName(shortest.from) + ' → ' + insightPlaceName(shortest.to)
                    }),
                    insightMetric('平均每段', insightKm(segment.average) + ' km'),
                    insightMetric('累计里程', insightKm(segment.totalKm) + ' km'),
                    insightMetric('最北', insightPlaceName(segment.north), {
                        action: () => insightOpenCity(segment.north.city)
                    }),
                    insightMetric('最南', insightPlaceName(segment.south), {
                        action: () => insightOpenCity(segment.south.city)
                    }),
                    insightMetric('最东', insightPlaceName(segment.east), {
                        action: () => insightOpenCity(segment.east.city)
                    }),
                    insightMetric('最西', insightPlaceName(segment.west), {
                        action: () => insightOpenCity(segment.west.city)
                    })
                ]
            });
        }

        // 5. 类型与季节交叉
        if (type.list.length) {
            const top = type.list[0];
            cards.push({
                id: 'type',
                kicker: 'TYPES · 主题',
                headline: '「' + top.name + '」出现了 ' + top.count + ' 次' +
                    (top.season
                        ? '，' + top.season + '天的风里，你出发得最多。'
                        : '，是你写得最多的一页。'),
                metrics: type.list.slice(0, 9).map(item => insightMetric(
                    item.name,
                    item.count + ' 次',
                    { hint: item.season ? '多在' + item.season + '天（' + item.seasonCount + ' 次）' : '' }
                ))
            });
        }

        // 6. 年度回顾：卡内切换年份
        if (years.length) {
            if (insightYearIndex >= years.length) insightYearIndex = 0;
            const active = years[insightYearIndex];
            cards.push({
                id: 'year',
                kicker: 'YEAR IN REVIEW · 年度回顾',
                headlineId: 'insightYearHeadline',
                headline: insightYearHeadline(active),
                chips: years.map((item, i) => ({
                    text: item.year + ' 年',
                    className: 'insight-year-chip',
                    active: i === insightYearIndex,
                    onClick: () => refreshInsightYearCard(i)
                })),
                metricsId: 'insightYearMetrics',
                metrics: insightYearMetrics(active)
            });
        }

        // 7. 称号与轻成就
        if (badges.length) {
            cards.push({
                id: 'badge',
                kicker: 'ACHIEVEMENTS · 称号与成就',
                headlineId: 'insightBadgeHeadline',
                headline: '「' + title + '」',
                note: titles.length ? '已解锁 ' + titles.length + ' / ' + INSIGHT_TITLE_SLOTS + ' 个称号' : '',
                chips: titles.length > 1 ? [{ text: '换一个称号', onClick: swapInsightTitle }] : [],
                badges
            });
        }

        return { title, cards };
    }

    function renderInsightDots() {
        const single = insightCards.length < 2;
        if (insightDots) {
            insightDots.innerHTML = '';
            insightDots.hidden = single;
            insightCards.forEach((card, i) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'insight-dot' + (i === insightCardIndex ? ' is-active' : '');
                dot.setAttribute('role', 'tab');
                dot.setAttribute('aria-selected', i === insightCardIndex ? 'true' : 'false');
                dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 张：' + card.kicker);
                dot.addEventListener('click', () => showInsightCard(i));
                insightDots.appendChild(dot);
            });
        }
        // 「3 / 7」：一眼看清在第几张、总共几张，点一下看下一张
        if (insightPageCount) {
            insightPageCount.hidden = single;
            insightPageCount.textContent = (insightCardIndex + 1) + ' / ' + insightCards.length;
            insightPageCount.setAttribute('aria-label',
                '第 ' + (insightCardIndex + 1) + ' 张，共 ' + insightCards.length + ' 张，点击看下一张');
        }
    }

    function showInsightCard(index) {
        if (!insightDeck || !insightCards.length) return;
        insightCardIndex = (index + insightCards.length) % insightCards.length;
        [...insightDeck.children].forEach((el, i) => {
            el.classList.toggle('is-active', i === insightCardIndex);
        });
        renderInsightDots();
        // 翻页后回到顶部，避免长卡片停在中间（真正滚动的是 feature-body）
        const scroller = insightView.querySelector('.feature-body');
        if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
    }

    function renderInsight() {
        if (!insightDeck) return;
        const data = insightCardsData();
        insightCards = data.cards;
        if (insightTitleEl) insightTitleEl.textContent = data.title || '';
        insightDeck.innerHTML = '';
        insightCards.forEach(card => insightDeck.appendChild(insightCardDom(card)));
        if (insightCardIndex >= insightCards.length) insightCardIndex = 0;
        const single = insightCards.length < 2;
        if (insightPrevCard) insightPrevCard.hidden = single;
        if (insightNextCard) insightNextCard.hidden = single;
        showInsightCard(insightCardIndex);
    }

    function openInsight() {
        if (!featureEnabled('enableInsight') || !insightView) return;
        // 说法序号不重置：关掉再打开会接着上一句往下走，而不是每次都被拉回同一句
        insightCardIndex = 0;
        insightYearIndex = 0;
        renderInsight();
        insightView.classList.add('show');
        setOverlayHidden(insightView, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            insightBack.focus();
        }
    }

    function closeInsight(returnFocus = true) {
        if (!insightView || !insightView.classList.contains('show')) return;
        insightView.classList.remove('show');
        setOverlayHidden(insightView, true);
        if (returnFocus) focusCityWallTop();
    }

    // ---------------- 旅行明信片 ----------------
    const postcardPreview = document.getElementById('postcardPreview');
    const postcardBack = document.getElementById('postcardBack');
    const postcardTitle = document.getElementById('postcardTitle');
    const postcardPreviewImg = document.getElementById('postcardPreviewImg');
    const postcardDownload = document.getElementById('postcardDownload');
    const postcardShare = document.getElementById('postcardShare');
    const postcardStage = document.getElementById('postcardStage');
    const postcardStatus = document.getElementById('postcardStatus');
    const postcardRetry = document.getElementById('postcardRetry');
    let postcardCi = -1;
    let postcardBlobUrl = '';
    let postcardFileName = '旅行明信片.png';

    if (typeof CanvasRenderingContext2D !== 'undefined' &&
        !CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            r = Math.min(r || 0, w / 2, h / 2);
            this.moveTo(x + r, y);
            this.arcTo(x + w, y, x + w, y + h, r);
            this.arcTo(x + w, y + h, x, y + h, r);
            this.arcTo(x, y + h, x, y, r);
            this.arcTo(x, y, x + w, y, r);
            this.closePath();
        };
    }

    function cityPostcardData(ci) {
        const city = cityList[ci];
        return {
            city: city ? city.city : '未知城市',
            province: '',
            ...cityWallCardData(ci)
        };
    }

    function loadPostcardImage(url) {
        return new Promise(resolve => {
            const img = new Image();
            // 强制走 CORS 模式：万一图片又跳到别的域名，加载会失败而不是悄悄把 canvas 污染掉
            // （canvas 一旦被污染，后面 toBlob 会直接抛 SecurityError，写信就整张出不来）
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = canvasSafeImageUrl(url);
        });
    }

    /**
     * 票根图可能放在别的域名（图床 / CDN，本地开发时页面域名和图片域名也常常不同）。
     * 跨域图既会被 CORS 拦掉，画进 canvas 之后也没法导出（toBlob 抛 SecurityError），
     * 所以跨域图统一走插件的同源代理 /footprints/image-proxy。
     */
    function canvasSafeImageUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.origin === window.location.origin) return url;
            return '/footprints/image-proxy?url=' + encodeURIComponent(parsed.href);
        } catch (e) {
            return url;
        }
    }

    // 城市小结：以真实照片为主角，讲"我和这座城市的关系"（第一次去 / 最近一次 / 走过的地方），
    // 不再是城市卡片墙那张卡的信息截图
    function postcardCanvas(data, image) {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1440;
        const ctx = canvas.getContext('2d');
        const ink = '#35423d';
        const muted = '#8b7865';
        const accent = '#9b704e';

        const bg = ctx.createLinearGradient(0, 0, 0, 1440);
        bg.addColorStop(0, '#e8e0d2');
        bg.addColorStop(1, '#d9cfbd');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 1080, 1440);
        ctx.strokeStyle = 'rgba(118,92,61,0.32)';
        ctx.lineWidth = 3;
        ctx.strokeRect(28, 28, 1024, 1384);

        ctx.fillStyle = accent;
        ctx.font = '600 30px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CITY POSTCARD · 旅行明信片', 540, 118);

        const cityName = data.city || '';
        ctx.fillStyle = ink;
        ctx.font = cityName.length > 6
            ? '400 72px "PingFang SC", "Microsoft YaHei", serif'
            : '400 96px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText(cityName, 540, 216);

        const subline = [data.province, data.count ? data.count + ' 个足迹' : ''].filter(Boolean).join(' · ');
        if (subline) {
            ctx.fillStyle = muted;
            ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
            ctx.fillText(subline, 540, 270);
        }

        // 真实照片当主角：cover 满铺 + clip，不垫底、不留白边
        const photoX = 42;
        const photoW = 996;
        const photoTop = 318;
        const photoH = 600;
        if (image) {
            const scale = Math.max(photoW / image.width, photoH / image.height);
            const dw = image.width * scale;
            const dh = image.height * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(photoX, photoTop, photoW, photoH);
            ctx.clip();
            ctx.drawImage(image, photoX + (photoW - dw) / 2, photoTop + (photoH - dh) / 2, dw, dh);
            ctx.restore();
        } else {
            const g = ctx.createLinearGradient(photoX, photoTop, photoX + photoW, photoTop + photoH);
            g.addColorStop(0, '#cdbfa6');
            g.addColorStop(1, '#b09a7d');
            ctx.fillStyle = g;
            ctx.fillRect(photoX, photoTop, photoW, photoH);
            ctx.fillStyle = 'rgba(255,253,247,0.9)';
            ctx.font = '400 220px "Noto Serif SC", "Songti SC", serif';
            ctx.fillText((data.city || '?').charAt(0), 540, photoTop + photoH * 0.62);
        }

        // 第一次去 / 最近一次：这张小结真正多出来的信息
        ctx.fillStyle = muted;
        ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('第一次去', 320, 1002);
        ctx.fillText('最近一次', 760, 1002);
        ctx.fillStyle = ink;
        ctx.font = '34px ui-monospace, Consolas, monospace';
        ctx.fillText(data.first ? formatCityDate(data.first) : '—', 320, 1050);
        ctx.fillText(data.latest ? formatCityDate(data.latest) : '—', 760, 1050);

        ctx.strokeStyle = 'rgba(118,92,61,0.24)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(140, 1104);
        ctx.lineTo(940, 1104);
        ctx.stroke();

        // 走过的地方：这座城市里到过的足迹名
        const places = (data.places || []).join(' · ');
        if (places) {
            ctx.fillStyle = muted;
            ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
            ctx.fillText('走过的地方', 540, 1154);
            ctx.fillStyle = ink;
            ctx.font = '30px "PingFang SC", "Microsoft YaHei", serif';
            wrapTicketLetterText(ctx, places, 860).slice(0, 2).forEach((line, i) => {
                ctx.fillText(line, 540, 1210 + i * 46);
            });
        }

        ctx.fillStyle = muted;
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText(
            data.count + ' 个足迹 · ' + data.photos + ' 张照片 · ' + data.tickets + ' 张票根',
            540, 1330
        );

        ctx.fillStyle = muted;
        ctx.font = '24px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('旅行记忆 · Travel Memory', 540, 1380);
        return canvas;
    }

    function postcardToBlob(canvas) {
        return new Promise(resolve => {
            try {
                canvas.toBlob(blob => resolve(blob), 'image/png');
            } catch (e) {
                resolve(null);
            }
        });
    }

    // 明信片页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
    function setPostcardState(state) {
        if (postcardStage) {
            postcardStage.classList.toggle('is-loading', state === 'loading');
            postcardStage.classList.toggle('is-ready', state === 'ready');
            postcardStage.classList.toggle('is-error', state === 'error');
            postcardStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        }
        if (postcardStatus) {
            postcardStatus.textContent = state === 'loading'
                ? '正在生成明信片…'
                : (state === 'error' ? '这张明信片没能生成，可能是城市照片取不到。' : '');
        }
        if (postcardRetry) postcardRetry.hidden = state !== 'error';
        if (postcardDownload) postcardDownload.disabled = state !== 'ready';
    }

    async function renderPostcardPreview() {
        if (postcardBlobUrl) URL.revokeObjectURL(postcardBlobUrl);
        const data = cityPostcardData(postcardCi);
        postcardTitle.textContent = data.city + ' · 旅行明信片';
        const city = cityList[postcardCi];
        data.province = city ? cityViewItems(postcardCi).map(fp => fp.province).find(Boolean) || '' : '';
        if (postcardShare) postcardShare.hidden = true;
        setPostcardState('loading');
        // 明信片是拿去下载/分享的成品图，用未经"缩略图替换规则"处理的原始地址；
        // 城市卡片墙继续用小图（cover），翻页才轻快
        const coverUrl = data.coverRaw || data.cover;
        const image = coverUrl ? await loadPostcardImage(coverUrl) : null;
        let canvas = postcardCanvas(data, image);
        let blob = await postcardToBlob(canvas);
        if (!blob) {
            canvas = postcardCanvas(data, null);
            blob = await postcardToBlob(canvas);
        }
        if (!blob) {
            setPostcardState('error');
            return;
        }
        postcardBlobUrl = URL.createObjectURL(blob);
        postcardPreviewImg.src = postcardBlobUrl;
        setPostcardState('ready');
        const ts = (data.latest || '').replace(/-/g, '');
        postcardFileName = data.city + '-' + (ts || 'postcard') + '-旅行明信片.png';
        postcardShare.hidden = !(
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [new File([blob], postcardFileName, { type: 'image/png' })] })
        );
    }

    async function openPostcard(ci, triggerBtn) {
        if (!featureEnabled('enablePostcard') || !cityList[ci] || !postcardPreview) return;
        postcardCi = ci;
        setPostcardState('loading');
        postcardPreviewImg.removeAttribute('src');
        postcardPreview.classList.add('show');
        setOverlayHidden(postcardPreview, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)) {
            postcardBack.focus();
        }
        await renderPostcardPreview();
    }

    function closePostcard(returnFocus = true) {
        if (!postcardPreview || !postcardPreview.classList.contains('show')) return;
        postcardPreview.classList.remove('show');
        setOverlayHidden(postcardPreview, true);
        postcardPreviewImg.removeAttribute('src');
        setPostcardState('loading');   // 下次打开从骨架态开始
        if (postcardBlobUrl) {
            URL.revokeObjectURL(postcardBlobUrl);
            postcardBlobUrl = '';
        }
        postcardCi = -1;
        if (returnFocus) focusCityWallTop();
    }

    function downloadPostcard() {
        if (!postcardBlobUrl) return;
        const a = document.createElement('a');
        a.href = postcardBlobUrl;
        a.download = postcardFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function sharePostcard() {
        if (!postcardBlobUrl) return;
        const blob = await fetch(postcardBlobUrl).then(r => r.blob());
        const file = new File([blob], postcardFileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: postcardFileName });
            } catch (e) { /* 用户取消分享无需处理 */ }
        }
    }

    if (cityWallTimeCapsuleBtn) cityWallTimeCapsuleBtn.addEventListener('click', openTimeCapsule);
    if (cityWallInsightBtn) cityWallInsightBtn.addEventListener('click', openInsight);
    timeCapsuleBack.addEventListener('click', () => closeTimeCapsule());
    timeCapsulePrev.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex - 1 + timeCapsuleItemsCache.length) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    timeCapsuleNext.addEventListener('click', () => {
        if (timeCapsuleItemsCache.length < 2) return;
        timeCapsuleIndex = (timeCapsuleIndex + 1) % timeCapsuleItemsCache.length;
        renderTimeCapsule();
    });
    insightBack.addEventListener('click', () => closeInsight());
    if (insightPrevCard) insightPrevCard.addEventListener('click', () => showInsightCard(insightCardIndex - 1));
    if (insightNextCard) insightNextCard.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    if (insightPageCount) insightPageCount.addEventListener('click', () => showInsightCard(insightCardIndex + 1));
    // 洞察卡左右翻页也支持键盘
    document.addEventListener('keydown', event => {
        if (!insightView || !insightView.classList.contains('show')) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showInsightCard(insightCardIndex - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showInsightCard(insightCardIndex + 1);
        }
    });
    postcardBack.addEventListener('click', () => closePostcard());
    postcardDownload.addEventListener('click', downloadPostcard);
    postcardShare.addEventListener('click', sharePostcard);
    postcardRetry.addEventListener('click', () => { renderPostcardPreview(); });
    [timeCapsule, insightView, postcardPreview].forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                if (overlay === timeCapsule) closeTimeCapsule();
                else if (overlay === insightView) closeInsight();
                else closePostcard();
            }
        });
    });

    cityWallBtn.addEventListener('click', openCityWall);
    cityWallBack.addEventListener('click', () => closeCityWall());
    if (cityWallProvinceFilter) {
        cityWallProvinceFilter.addEventListener('click', () => setCityWallProvinceFilter(''));
    }
    // 数据重新加载（如刷新直达）后，若卡片墙正处于打开状态则重建
    document.addEventListener('footprints:loaded', () => {
        if (cityWall && cityWall.classList.contains('show')) renderCityWall();
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
        footprintsDataReady = true;
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
                    fill: Cesium.Color.fromCssColorString(fillColor.fill)
                    // 轮廓用独立的贴合地面折线绘制，不交给 GeoJsonDataSource，
                    // 避免 Cesium 对 terrain 上的 outline 报“不支持”的警告
                });
            }).then(ds => {
                if (!ds) return;
                if (buildId !== cityFillBuildId) {   // 已被更新的构建取代
                    viewer.dataSources.remove(ds);
                    return;
                }
                ds.show = false;   // 默认隐藏，放大到国内范围后显示

                // 边界轮廓：从多边形层级中提取外环与孔洞环，闭合后画成贴合地面的折线
                const now = Cesium.JulianDate.now();
                ds.entities.values.forEach(entity => {
                    const polygon = entity.polygon;
                    if (!polygon || !polygon.hierarchy) return;
                    // clampToGround + terrain 不支持 polygon outline，轮廓统一用贴合地面的折线绘制
                    polygon.outline = false;
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

                viewer.dataSources.add(ds);
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
    const ticketGalleryEmpty = document.getElementById('ticketGalleryEmpty');
    const ticketGalleryStats = document.getElementById('ticketGalleryStats');
    const ticketLightbox = ticketGallery;
    const ticketWallet = document.getElementById('ticketWallet');
    const ticketGalleryHint = document.getElementById('ticketGalleryHint');
    const ticketStrip = document.getElementById('ticketStrip');
    const ticketStripScroller = document.getElementById('ticketStripScroller');
    const ticketStripProgress = document.getElementById('ticketStripProgress');
    const ticketStripHint = document.getElementById('ticketStripHint');
    const ticketMetaPanel = document.getElementById('ticketMetaPanel');
    const ticketLightboxLoading = document.getElementById('ticketGalleryLoading');
    const ticketLightboxError = document.getElementById('ticketGalleryError');
    const ticketLightboxTitle = document.getElementById('ticketGalleryTitle');
    const ticketLightboxPinyin = document.getElementById('ticketGalleryPinyin');
    const ticketLightboxEnglish = document.getElementById('ticketGalleryEnglish');
    const ticketLightboxSubtitle = document.getElementById('ticketGallerySubtitle');
    const ticketLightboxDetails = document.getElementById('ticketGalleryDetails');
    const ticketLightboxDescription = document.getElementById('ticketGalleryDescription');
    const ticketLightboxCount = document.getElementById('ticketGalleryPosition');
    const ticketLightboxRetry = document.getElementById('ticketGalleryRetry');
    const ticketPassportBtn = document.getElementById('ticketPassportBtn');
    const ticketPassportCount = document.getElementById('ticketPassportCount');
    const ticketPassport = document.getElementById('ticketPassport');
    const ticketPassportBack = document.getElementById('ticketPassportBack');
    const ticketPassportGrid = document.getElementById('ticketPassportGrid');
    const ticketPassportStats = document.getElementById('ticketPassportStats');
    const ticketPassportReset = document.getElementById('ticketPassportReset');
    const ticketStampBadge = document.getElementById('ticketStampBadge');
    const ticketOracleBtn = document.getElementById('ticketOracleBtn');
    const ticketOracle = document.getElementById('ticketOracle');
    const ticketOracleBack = document.getElementById('ticketOracleBack');
    const ticketOracleCard = document.getElementById('ticketOracleCard');
    const ticketOracleStats = document.getElementById('ticketOracleStats');
    const ticketOracleInspiration = document.getElementById('ticketOracleInspiration');
    const ticketOracleView = document.getElementById('ticketOracleView');
    const ticketOracleAgain = document.getElementById('ticketOracleAgain');
    const ticketOracleClose = document.getElementById('ticketOracleClose');
    const ticketLetterBtn = document.getElementById('ticketLetterBtn');
    const ticketLetter = document.getElementById('ticketLetter');
    const ticketLetterBack = document.getElementById('ticketLetterBack');
    const ticketLetterTitle = document.getElementById('ticketLetterTitle');
    const ticketLetterImg = document.getElementById('ticketLetterImg');
    const ticketLetterStage = document.getElementById('ticketLetterStage');
    const ticketLetterStatus = document.getElementById('ticketLetterStatus');
    const ticketLetterRetry = document.getElementById('ticketLetterRetry');
    const ticketLetterCaption = document.getElementById('ticketLetterCaption');
    const ticketLetterDownload = document.getElementById('ticketLetterDownload');
    const ticketLetterShare = document.getElementById('ticketLetterShare');
    const ticketViewModes = document.getElementById('ticketViewModes');
    const ticketCityFilterChip = document.getElementById('ticketCityFilter');
    const ticketModeArchiveBtn = document.getElementById('ticketModeArchiveBtn');
    const ticketModeReplayBtn = document.getElementById('ticketModeReplayBtn');
    const ticketReplayView = document.getElementById('ticketReplayView');
    const ticketReplayCard = document.getElementById('ticketReplayCard');
    const ticketReplaySubtitle = document.getElementById('ticketReplaySubtitle');
    const ticketReplayCityBadge = document.getElementById('ticketReplayCityBadge');
    const ticketReplayRoute = document.getElementById('ticketReplayRoute');
    const ticketReplayDistance = document.getElementById('ticketReplayDistance');
    const ticketReplayTotal = document.getElementById('ticketReplayTotal');
    const ticketReplayProgressText = document.getElementById('ticketReplayProgressText');
    const ticketReplayEta = document.getElementById('ticketReplayEta');
    const ticketReplayBarInner = document.getElementById('ticketReplayBarInner');
    const ticketReplayPrev = document.getElementById('ticketReplayPrev');
    const ticketReplayPlay = document.getElementById('ticketReplayPlay');
    const ticketReplayNext = document.getElementById('ticketReplayNext');
    const ticketReplayExit = document.getElementById('ticketReplayExit');
    const ticketReplaySpeed = document.getElementById('ticketReplaySpeed');
    const ticketReplayOpen = document.getElementById('ticketReplayOpen');
    const ticketReplayFlight = document.getElementById('ticketReplayFlight');
    const ticketReplayFlightLabel = document.getElementById('ticketReplayFlightLabel');
    const ticketReplayFlightFrom = document.getElementById('ticketReplayFlightFrom');
    const ticketReplayFlightCity = document.getElementById('ticketReplayFlightCity');
    const ticketReplayFlightKm = document.getElementById('ticketReplayFlightKm');
    const ticketReplayEnd = document.getElementById('ticketReplayEnd');
    const ticketReplayEndRange = document.getElementById('ticketReplayEndRange');
    const ticketReplayEndTickets = document.getElementById('ticketReplayEndTickets');
    const ticketReplayEndCities = document.getElementById('ticketReplayEndCities');
    const ticketReplayEndKm = document.getElementById('ticketReplayEndKm');
    const ticketReplayEndSpan = document.getElementById('ticketReplayEndSpan');
    const ticketReplayEndNote = document.getElementById('ticketReplayEndNote');
    const ticketReplayAgain = document.getElementById('ticketReplayAgain');
    const ticketReplayCloseEnd = document.getElementById('ticketReplayCloseEnd');
    let ticketItems = [];
    let ticketIndex = 0;
    let ticketTrigger = null;
    let walletItems = [];      // 票夹中的票根元素 [{ fp, img }]
    const ticketImagePool = new Map();   // 已成功加载的票根图 → img，重复打开直接复用，避免重复请求
    let wheelLocked = false;   // 滚轮切换节流
    let walletTouchX = null;   // 触摸滑动起点
    let walletSwiped = false;  // 滑动后抑制随后的 click，避免一次滑动触发两次切换
    let stripScrollTimer = null;   // 横向长串滚轮停稳后的吸附计时
    let stripDrag = null;          // 横向长串拖拽状态
    // 后台“票根切换样式”：fan = 票夹叠放；strip = 横向长串浏览
    const ticketStripMode = !!(footprintCfg && footprintCfg.ticketGalleryStyle === 'strip');

    // 票根页创意功能：护照集章 + 时间有色（阶段 A）
    const TICKET_PASSPORT_STORAGE_KEY = 'footprint-ticket-passport-v1';
    const TICKET_STAMP_DWELL_MS = 1500;
    let ticketPassportRecords = [];
    let ticketStampTimer = null;
    let ticketStampIndex = -1;
    let ticketViewMode = 'archive';   // archive | replay
    let ticketCityFilter = '';        // 只看某座城市的票根（从城市卡片的票根徽章进来时设置）
    let ticketCityFilterName = '';
    let ticketOracleTimer = null;
    let ticketOracleCandidate = null;
    let ticketOracleLastIndex = -1;
    let ticketLetterFp = null;
    let ticketLetterBlobUrl = '';
    let ticketLetterFileName = '';
    let ticketLetterRenderToken = 0;   // 明信片渲染令牌：关闭浮层后丢弃未完成的渲染结果
    let ticketReplayItems = [];
    let ticketReplayPoints = [];
    let ticketReplayIndex = 0;
    let ticketReplayPlaying = false;
    let ticketReplayFlying = false;
    let ticketReplayTimer = null;
    let ticketReplayGeneration = 0;
    let ticketReplayPrevAutoRotate = false;
    let ticketReplayEntryIndex = 0;              // 进入放映时的票根，退出后回到这一张
    let ticketReplayResumeIndex = -1;            // 切回票夹后，重走再进来接着播的位置
    let ticketReplayPausedByOverlay = false;     // 浮层（护照/抽票/明信片）暂停放映的标记
    let ticketReplaySpeedValue = 1;              // 播放倍速：1 或 2
    const TICKET_REPLAY_DWELL_MS = 4200;

    function ticketFeatureOn(key) {
        return !!(footprintCfg && footprintCfg[key] === true);
    }

    function ticketStampId(fp) {
        if (!fp) return '';
        const raw = fp.key ||
            ticketImageUrl(fp.ticketImage) ||
            [fp.name, fp.ticketNo, fp.ticketDate || fp.createTime].filter(Boolean).join('|');
        return String(raw || '').trim() || String(fp.name || '未知票根').trim();
    }

    function loadTicketPassport() {
        try {
            const parsed = JSON.parse(localStorage.getItem(TICKET_PASSPORT_STORAGE_KEY));
            ticketPassportRecords = Array.isArray(parsed) ? parsed.filter(r => r && r.id) : [];
        } catch (e) {
            ticketPassportRecords = [];
        }
    }

    // 打开护照时按当前票根列表清理失效记录：
    // 既避免 localStorage 只增不减，也避免删掉再重建的票根（identifier 相同）直接带上旧章。
    // 票根列表为空时不清理，防止数据还没加载完就误删整本护照。
    function pruneTicketPassport() {
        if (!ticketItems.length || !ticketPassportRecords.length) return false;
        const valid = new Set(ticketItems.map(ticketStampId).filter(Boolean));
        const kept = ticketPassportRecords.filter(record => valid.has(record.id));
        if (kept.length === ticketPassportRecords.length) return false;
        ticketPassportRecords = kept;
        persistTicketPassport();
        return true;
    }

    function persistTicketPassport() {
        try {
            localStorage.setItem(TICKET_PASSPORT_STORAGE_KEY, JSON.stringify(ticketPassportRecords));
        } catch (e) {
            /* 隐私模式/存储满时静默失败，不影响票根浏览 */
        }
    }

    function isTicketStamped(fp) {
        if (!fp) return false;
        const id = ticketStampId(fp);
        return ticketPassportRecords.some(record => record.id === id);
    }

    function clearTicketStampTimer() {
        if (ticketStampTimer) {
            clearTimeout(ticketStampTimer);
            ticketStampTimer = null;
        }
        ticketStampIndex = -1;
    }

    function stampTicket(fp) {
        if (!fp || !ticketFeatureOn('enableTicketPassport') || isTicketStamped(fp)) return;
        ticketPassportRecords.push({
            id: ticketStampId(fp),
            stampedAt: new Date().toISOString()
        });
        persistTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(fp, true);
    }

    function updateTicketPassportButton() {
        if (!ticketPassportBtn || !ticketPassportCount) return;
        const enabled = ticketFeatureOn('enableTicketPassport');
        ticketPassportBtn.hidden = !enabled || ticketItems.length === 0;
        if (!enabled) return;
        const stamped = ticketItems.filter(fp => isTicketStamped(fp)).length;
        ticketPassportCount.textContent = stamped + '/' + ticketItems.length;
    }

    function updateTicketLetterAction(fp) {
        if (!ticketLetterBtn) return;
        ticketLetterBtn.hidden = !ticketFeatureOn('enableTicketLetter') || !fp;
    }

    function updateTicketModeButtons() {
        if (!ticketViewModes) return;
        const replayEnabled = ticketFeatureOn('enableTicketJourneyReplay') &&
            ticketItems.filter(ticketHasCoordinate).length >= 2;
        ticketViewModes.hidden = !replayEnabled;
        if (!replayEnabled) return;
        // 只剩重走一个模式：顶部就是「票夹 / 重走」两段切换器（方案 §10）
        if (ticketModeArchiveBtn) ticketModeArchiveBtn.hidden = false;
        if (ticketModeReplayBtn) ticketModeReplayBtn.hidden = false;
        const active = ticketViewMode === 'replay' ? 'replay' : 'archive';
        if (ticketModeArchiveBtn) ticketModeArchiveBtn.classList.toggle('is-active', active === 'archive');
        if (ticketModeReplayBtn) ticketModeReplayBtn.classList.toggle('is-active', active === 'replay');
    }

    // 城市筛选：从城市卡片的票根徽章进来时，票根页只看这座城市
    function renderTicketCityFilter() {
        if (!ticketCityFilterChip) return;
        ticketCityFilterChip.hidden = !ticketCityFilter;
        if (!ticketCityFilter) return;
        ticketCityFilterChip.textContent = '只看 ' + ticketCityFilterName + ' ✕';
        ticketCityFilterChip.setAttribute('aria-label',
            '清除筛选，显示全部城市的票根（当前只看 ' + ticketCityFilterName + '）');
    }

    function resetTicketCityFilter() {
        ticketCityFilter = '';
        ticketCityFilterName = '';
        renderTicketCityFilter();
    }

    // 票根页是透明背景、刻意透出背后的 3D 地球；而卡片墙 / 城市图片墙是不透明浮层。
    // 从它们上面打开票根页时如果不把这层收起来，背景就会一直是那张卡片墙。
    // 这里只做「临时隐藏」：不改它们的 .show、不动滚动位置，关掉票根页时原样放回。
    let ticketUnderlayLayers = [];
    let ticketUnderlayFocus = null;

    function setTicketBackLabel(text) {
        if (!ticketGalleryBack) return;
        ticketGalleryBack.setAttribute('aria-label', text);
        const label = ticketGalleryBack.querySelector('span');
        if (label) label.textContent = text;
    }

    function hideTicketUnderlay() {
        const layers = [];
        if (cityView && cityView.classList.contains('show')) layers.push(cityView);
        if (cityWall && cityWall.classList.contains('show')) layers.push(cityWall);
        if (!layers.length) return;
        ticketUnderlayLayers = layers;
        ticketUnderlayFocus = layers.some(el => el.contains(document.activeElement))
            ? document.activeElement
            : null;
        layers.forEach(el => {
            el.classList.add('is-ticket-underlay');
            setOverlayHidden(el, true);   // 收起期间键盘和读屏都到不了它
        });
        document.body.classList.add('ticket-underlay-hidden');
        // 这两层打开时都会暂停地球渲染（省性能），票根页要透出地球，这里恢复渲染
        setGlobeRenderLoop(true);
        setTicketBackLabel('返回城市卡片');
    }

    function restoreTicketUnderlay() {
        const layers = ticketUnderlayLayers;
        ticketUnderlayLayers = [];
        if (!layers.length) {
            ticketUnderlayFocus = null;
            return;
        }
        layers.forEach(el => {
            el.classList.remove('is-ticket-underlay');
            setOverlayHidden(el, false);
        });
        document.body.classList.remove('ticket-underlay-hidden');
        // 不透明浮层重新盖住地球，继续暂停渲染（与 openCityWall / openCityView 一致）
        setGlobeRenderLoop(false);
        setTicketBackLabel('返回地球');
    }

    function openTicketGalleryForCity(ci) {
        const city = cityList[ci];
        if (!city || !city.key) return;
        ticketCityFilter = city.key;
        ticketCityFilterName = city.city;
        setTicketView(true);            // 打开时会按筛选重建 ticketItems
        updateTicketFeatureButtons();
    }

    // 城市筛选只属于票夹视图：切到重走、打开抽票/护照时先清掉，
    // 否则这些按 ticketItems 取数据的入口会莫名只剩一座城市
    function ensureTicketCityFilterCleared() {
        if (!ticketCityFilter) return;
        resetTicketCityFilter();
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = 0;
        buildTicketWallet();
        renderTicketWallet();
    }

    function updateTicketFeatureButtons() {
        updateTicketPassportButton();
        updateTicketModeButtons();
        renderTicketCityFilter();
        if (ticketOracleBtn) {
            ticketOracleBtn.hidden = !ticketFeatureOn('enableTicketOracle') || ticketItems.length === 0;
        }
        updateTicketLetterAction(ticketItems[ticketIndex]);
    }

    function updateTicketStampBadge(fp, animate) {
        if (!ticketStampBadge) return;
        const stamped = ticketFeatureOn('enableTicketPassport') && isTicketStamped(fp);
        ticketStampBadge.hidden = !stamped;
        if (!stamped) return;
        const meta = ticketMeta(fp);
        ticketStampBadge.textContent = '已检票 · ' + (fp.city || meta.route || '') +
            (meta.date ? ' · ' + meta.date : '');
        if (animate) {
            ticketStampBadge.classList.remove('is-stale');
            void ticketStampBadge.offsetWidth;
        } else {
            ticketStampBadge.classList.add('is-stale');
        }
    }

    function startTicketStampDwell(fp) {
        clearTicketStampTimer();
        if (!ticketFeatureOn('enableTicketPassport') || ticketViewMode !== 'archive') return;
        if (isTicketStamped(fp)) return;
        ticketStampIndex = ticketIndex;
        ticketStampTimer = setTimeout(() => {
            ticketStampTimer = null;
            if (ticketGallery.classList.contains('show') &&
                ticketViewMode === 'archive' &&
                ticketIndex === ticketStampIndex &&
                ticketItems[ticketIndex] === fp &&
                !isTicketStamped(fp)) {
                stampTicket(fp);
            }
        }, TICKET_STAMP_DWELL_MS);
    }

    function renderTicketPassport() {
        if (!ticketPassportGrid || !ticketPassportStats) return;
        if (pruneTicketPassport()) updateTicketPassportButton();
        const ordered = ticketItems.slice().sort(compareTicketByTime);
        ticketPassportGrid.innerHTML = '';
        ordered.forEach(fp => {
            const stamped = isTicketStamped(fp);
            const cell = document.createElement('div');
            cell.className = 'ticket-passport-cell' + (stamped ? '' : ' is-missing');
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = ticketImageUrl(fp.ticketImage);
            img.alt = '';
            const status = document.createElement('span');
            status.className = 'ticket-passport-cell-status';
            status.textContent = stamped ? '已检票' : '未检票';
            const title = document.createElement('span');
            title.className = 'ticket-passport-cell-title';
            title.textContent = [fp.name || fp.ticketTitle, fp.city].filter(Boolean).join(' · ');
            cell.append(img, status, title);
            ticketPassportGrid.appendChild(cell);
        });
        const stamped = ordered.filter(fp => isTicketStamped(fp)).length;
        ticketPassportStats.textContent = stamped + ' / ' + ordered.length + ' 已集章' +
            (stamped === ordered.length && ordered.length ? ' · 全站抵达' : '');
        if (ticketPassportReset) {
            ticketPassportReset.hidden = ordered.length === 0;
        }
    }

    function openTicketPassport() {
        if (!ticketFeatureOn('enableTicketPassport') || !ticketItems.length || !ticketPassport) return;
        ensureTicketCityFilterCleared();
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        renderTicketPassport();
        ticketPassport.classList.add('show');
        setOverlayHidden(ticketPassport, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketPassportBack) {
            ticketPassportBack.focus();
        }
    }

    function closeTicketPassport(returnFocus = true) {
        if (!ticketPassport || !ticketPassport.classList.contains('show')) return;
        ticketPassport.classList.remove('show');
        setOverlayHidden(ticketPassport, true);
        if (returnFocus && ticketPassportBtn && !ticketPassportBtn.hidden) {
            ticketPassportBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    // 时间有色：按票根日期月份决定页面氛围（阶段 A）
    function ticketSeasonKey(fp) {
        const raw = String((fp && (fp.ticketDate || fp.createTime)) || '');
        const match = /^(\d{4})[-/.](\d{1,2})/.exec(raw);
        if (!match) return '';
        const month = Number(match[2]);
        if (month >= 3 && month <= 5) return 'spring';
        if (month >= 6 && month <= 8) return 'summer';
        if (month >= 9 && month <= 11) return 'autumn';
        return 'winter';
    }

    function applyTicketSeason(fp) {
        if (!ticketGallery) return;
        // 时间有色只改文字强调色（CSS 变量 --season-accent），不碰背景、票根图与地球
        const season = fp ? ticketSeasonKey(fp) : '';
        if (season && ticketFeatureOn('enableTicketSeasonLight')) {
            ticketGallery.dataset.season = season;
        } else {
            ticketGallery.removeAttribute('data-season');
        }
    }

    function resetTicketSeason() {
        if (ticketGallery) {
            ticketGallery.removeAttribute('data-season');
        }
    }


    // ================= 命运抽票（阶段 B） =================
    function ticketOracleBackFace() {
        if (!ticketOracleCard) return;
        ticketOracleCard.classList.remove('is-back');
        void ticketOracleCard.offsetWidth;
        ticketOracleCard.classList.add('is-back');
        ticketOracleCard.innerHTML = '';
        if (ticketOracleStats) {
            ticketOracleStats.textContent = '正在翻找一张票…';
        }
        if (ticketOracleInspiration) ticketOracleInspiration.textContent = '';
        if (ticketOracleView) ticketOracleView.disabled = true;
    }

    function ticketOracleShowCandidate(fp) {
        if (!ticketOracleCard || !fp) return;
        ticketOracleCard.classList.remove('is-back', 'is-shuffling');
        ticketOracleCard.innerHTML = '';
        const img = document.createElement('img');
        img.alt = fp.ticketTitle || fp.name || '票根';
        img.referrerPolicy = 'no-referrer';
        img.src = ticketImageUrl(fp.ticketImage);
        img.onerror = () => {
            ticketOracleCard.innerHTML = '<span style="padding:20px;color:#6e5945;">这张票根暂时打不开<br>但它仍是一段旅程</span>';
        };
        ticketOracleCard.appendChild(img);
        const meta = ticketMeta(fp);
        if (ticketOracleStats) {
            ticketOracleStats.textContent = (fp.city || meta.route || '未知城市') +
                (meta.date ? ' · ' + meta.date : '') +
                (fp.name ? ' · ' + fp.name : '');
        }
        if (ticketOracleInspiration) {
            ticketOracleInspiration.textContent = nextTicketStopSuggestion();
        }
        if (ticketOracleView) ticketOracleView.disabled = false;
    }

    function nextTicketStopSuggestion() {
        // 与城市聚合同一套键：adcode 优先，避免同一座城市因为写法不同被当成"没去过"
        const ticketCities = new Set(ticketItems.map(cityKeyOf).filter(Boolean));
        const candidates = [];
        FOOTPRINTS.forEach(fp => {
            if (ticketImageUrl(fp.ticketImage) || !fp.city) return;
            const key = cityKeyOf(fp);
            if (!key || ticketCities.has(key) || candidates.includes(fp.city)) return;
            candidates.push(fp.city);
        });
        if (candidates.length) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            return '下一站，或许可以去「' + pick + '」看看。';
        }
        const fallbacks = [
            '把去过的城市再走一遍也不错，下一张票根正在等你。',
            '旅行的下一站不在地图上，而在你的心里。',
            '所有出发都是回家，只是路线不同。'
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    function ticketOracleShuffle() {
        clearTimeout(ticketOracleTimer);
        ticketOracleCandidate = null;
        ticketOracleBackFace();
        if (ticketOracleCard) ticketOracleCard.classList.add('is-shuffling');
        if (ticketOracleAgain) ticketOracleAgain.disabled = true;
        let steps = 0;
        const tick = () => {
            steps++;
            if (steps >= 7) {
                if (ticketOracleCard) ticketOracleCard.classList.remove('is-shuffling');
                const pickable = ticketItems.length > 1;
                let idx = ticketOracleLastIndex;
                while (pickable && idx === ticketOracleLastIndex) {
                    idx = Math.floor(Math.random() * ticketItems.length);
                }
                // 只有一张票根时不会进入上面的循环，idx 会停在 -1（对应 undefined），
                // 结果卡片一直停在背面、按钮永远不可用；这里兜底到第一张。
                if (idx < 0 || !ticketItems[idx]) idx = 0;
                ticketOracleLastIndex = idx;
                ticketOracleCandidate = ticketItems[idx];
                ticketOracleShowCandidate(ticketOracleCandidate);
                if (ticketOracleAgain) ticketOracleAgain.disabled = false;
                return;
            }
            ticketOracleTimer = setTimeout(tick, 130);
        };
        ticketOracleTimer = setTimeout(tick, 130);
    }

    function openTicketOracle() {
        if (!ticketFeatureOn('enableTicketOracle') || !ticketItems.length || !ticketOracle) return;
        ensureTicketCityFilterCleared();
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        ticketOracle.classList.add('show');
        setOverlayHidden(ticketOracle, false);
        ticketOracleShuffle();
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketOracleBack) {
            ticketOracleBack.focus();
        }
    }

    function closeTicketOracle(returnFocus = true) {
        if (!ticketOracle || !ticketOracle.classList.contains('show')) return;
        clearTimeout(ticketOracleTimer);
        ticketOracleTimer = null;
        ticketOracleCandidate = null;
        ticketOracle.classList.remove('show');
        setOverlayHidden(ticketOracle, true);
        if (returnFocus && ticketOracleBtn && !ticketOracleBtn.hidden) {
            ticketOracleBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    function openOracleTicketInArchive() {
        if (!ticketOracleCandidate) return;
        const idx = ticketItems.indexOf(ticketOracleCandidate);
        closeTicketOracle(false);
        if (idx < 0) return;
        // 抽票浮层里点「查看这张票」：先回到票夹，再定位到这张票
        if (ticketViewMode !== 'archive') setTicketViewMode('archive');
        ticketIndex = idx;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
    }

    // 重走里点「查看这张票」：回到票夹并定位到当前这一站
    function openReplayTicketInArchive() {
        const fp = ticketReplayPoints[ticketReplayIndex];
        if (!fp) return;
        const idx = ticketItems.indexOf(fp);
        if (idx < 0) return;
        if (ticketViewMode !== 'archive') setTicketViewMode('archive');
        ticketIndex = idx;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
    }

    // ================= 未寄出的明信片（阶段 B） =================
    function wrapTicketLetterText(ctx, text, maxWidth) {
        const lines = [];
        String(text || '').split('\n').forEach(paragraph => {
            let line = '';
            paragraph.split('').forEach(ch => {
                const test = line + ch;
                if (ctx.measureText(test).width > maxWidth && line) {
                    lines.push(line);
                    line = ch;
                } else {
                    line = test;
                }
            });
            if (line) lines.push(line);
        });
        return lines;
    }

    function ticketLetterCanvas(fp, image) {
        const meta = ticketMeta(fp);
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1280;
        const ctx = canvas.getContext('2d');
        const cream = '#f3eee2';
        const ink = '#35423d';
        const muted = '#8b7865';
        const accent = '#9b704e';
        const bg = ctx.createLinearGradient(0, 0, 0, 1280);
        bg.addColorStop(0, '#e8e0d2');
        bg.addColorStop(1, '#d6cbb8');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 900, 1280);
        ctx.strokeStyle = 'rgba(118,92,61,0.34)';
        ctx.lineWidth = 3;
        ctx.strokeRect(24, 24, 852, 1232);

        ctx.fillStyle = accent;
        ctx.font = '600 24px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('A LETTER FROM A TICKET', 450, 78);
        ctx.fillStyle = ink;
        ctx.font = '400 44px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.fillText('未寄出的明信片', 450, 132);

        // 票根图直接贴在纸面上：不垫白卡、不加粗边框，按内容宽度铺满，
        // 高度由图片自身比例决定；下面的正文起点跟着图高浮动，长图短图都不会顶到文字。
        const shotX = 40;
        const shotW = 820;
        const shotTop = 168;
        const shotMaxH = 520;
        let shotBottom = shotTop + 360;
        if (image) {
            const scale = Math.min(shotW / image.width, shotMaxH / image.height);
            const dw = image.width * scale;
            const dh = image.height * scale;
            const dx = shotX + (shotW - dw) / 2;
            ctx.drawImage(image, dx, shotTop, dw, dh);
            shotBottom = shotTop + dh;
        } else {
            ctx.fillStyle = '#e4dccd';
            ctx.fillRect(shotX, shotTop, shotW, shotBottom - shotTop);
            ctx.fillStyle = muted;
            ctx.font = '400 150px "Noto Serif SC", "Songti SC", serif';
            ctx.textAlign = 'center';
            ctx.fillText((fp.city || '?').charAt(0), 450, shotTop + 260);
        }
        // 图下小字：城市 · 日期 · 票根名
        ctx.fillStyle = muted;
        ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.textAlign = 'center';
        ctx.fillText(
            [fp.city || meta.route, meta.date, fp.name || meta.title].filter(Boolean).join(' · '),
            450,
            shotBottom + 44
        );

        // 信件正文
        const desc = String(fp.description || '').trim();
        const noText = meta.no ? '，编号是 ' + meta.no : '';
        const typeText = fp.ticketType ? '；那是一段关于「' + fp.ticketType + '」的旅程' : '';
        const descText = desc ? ' 我还记得：' + (desc.length > 80 ? desc.slice(0, 80) + '…' : desc) : '';
        const letter =
            '致许多年后的自己：\n' +
            '这一张票根，写于' + (meta.date || '某一天') + '的' + (fp.city || meta.route || '远方') + '。\n' +
            '那时候的旅程叫「' + (meta.title || '一次出发') + '」' + noText + typeText + '。' +
            descText + '当时没有说出口的话，都留在这张纸里了。\n' +
            '—— 一张票根，代替当时的我寄出。';
        ctx.fillStyle = ink;
        ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", "Noto Serif SC", serif';
        ctx.textAlign = 'left';
        const lines = wrapTicketLetterText(ctx, letter, 760);
        const lineHeight = 46;
        const startY = shotBottom + 106;
        // 正文行数按剩余高度算：图高变化时不会把落款挤出去
        const maxLines = Math.max(4, Math.floor((1224 - startY) / lineHeight));
        lines.slice(0, maxLines).forEach((line, i) => {
            ctx.fillText(line, 70, startY + i * lineHeight);
        });

        ctx.textAlign = 'right';
        ctx.fillStyle = muted;
        ctx.font = '26px "PingFang SC", "Microsoft YaHei", serif';
        ctx.fillText('旅行记忆 · 票根收藏', 852, 1245);
        return canvas;
    }

    // 写信页三种状态：loading（骨架 + 文案）/ ready（出图 + 可下载）/ error（说明 + 重新生成）
    function setTicketLetterState(state) {
        if (ticketLetterStage) {
            ticketLetterStage.classList.toggle('is-loading', state === 'loading');
            ticketLetterStage.classList.toggle('is-ready', state === 'ready');
            ticketLetterStage.classList.toggle('is-error', state === 'error');
            ticketLetterStage.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        }
        if (ticketLetterStatus) {
            ticketLetterStatus.textContent = state === 'loading'
                ? '正在写这封信…'
                : (state === 'error' ? '这封信没能生成，可能是票根图取不到。' : '');
        }
        if (ticketLetterRetry) ticketLetterRetry.hidden = state !== 'error';
        if (ticketLetterDownload) ticketLetterDownload.disabled = state !== 'ready';
    }

    async function renderTicketLetter() {
        const fp = ticketLetterFp;
        if (!fp) return;
        // 渲染是异步的（图片 + 两次 toBlob）：关闭浮层或换票后本次结果作废，
        // 否则会把 blob URL 和 src 写回已关闭的浮层，并漏掉一次 revokeObjectURL
        const token = ++ticketLetterRenderToken;
        if (ticketLetterBlobUrl) URL.revokeObjectURL(ticketLetterBlobUrl);
        ticketLetterBlobUrl = '';
        if (ticketLetterShare) ticketLetterShare.hidden = true;
        setTicketLetterState('loading');
        const image = await loadPostcardImage(ticketImageUrl(fp.ticketImage));
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        let canvas = ticketLetterCanvas(fp, image);
        let blob = await postcardToBlob(canvas);
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        if (!blob) {
            canvas = ticketLetterCanvas(fp, null);
            blob = await postcardToBlob(canvas);
        }
        if (!blob) {
            setTicketLetterState('error');
            return;
        }
        if (token !== ticketLetterRenderToken || ticketLetterFp !== fp) return;
        ticketLetterBlobUrl = URL.createObjectURL(blob);
        ticketLetterImg.src = ticketLetterBlobUrl;
        setTicketLetterState('ready');
        const ts = String(fp.ticketDate || fp.createTime || '').replace(/-/g, '');
        ticketLetterFileName = (fp.city || '票根') + '-' + (ts || 'letter') + '-未寄出的明信片.png';
        ticketLetterShare.hidden = !(
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [new File([blob], ticketLetterFileName, { type: 'image/png' })] })
        );
    }

    async function openTicketLetter(fp) {
        if (!ticketFeatureOn('enableTicketLetter') || !fp || !ticketLetter) return;
        clearTicketStampTimer();
        pauseTicketReplayForOverlay();
        ticketLetterFp = fp;
        if (ticketLetterTitle) {
            ticketLetterTitle.textContent = (fp.city ? fp.city + ' · ' : '') + '未寄出的明信片';
        }
        const meta = ticketMeta(fp);
        if (ticketLetterCaption) {
            ticketLetterCaption.textContent = [
                '由「' + (fp.name || meta.title || '这张票根') + '」写成',
                fp.city || meta.route,
                meta.date
            ].filter(Boolean).join(' · ');
        }
        if (ticketLetterImg) {
            ticketLetterImg.alt = (fp.city || '票根') + ' 的未寄出的明信片';
        }
        setTicketLetterState('loading');
        ticketLetterImg.removeAttribute('src');
        ticketLetter.classList.add('show');
        setOverlayHidden(ticketLetter, false);
        if (!(window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) &&
            ticketLetterBack) {
            ticketLetterBack.focus();
        }
        await renderTicketLetter();
    }

    function closeTicketLetter(returnFocus = true) {
        if (!ticketLetter || !ticketLetter.classList.contains('show')) return;
        ticketLetterRenderToken++;   // 作废仍在进行中的渲染
        ticketLetter.classList.remove('show');
        setOverlayHidden(ticketLetter, true);
        ticketLetterImg.removeAttribute('src');
        setTicketLetterState('loading');   // 下次打开从骨架态开始
        if (ticketLetterBlobUrl) {
            URL.revokeObjectURL(ticketLetterBlobUrl);
            ticketLetterBlobUrl = '';
        }
        ticketLetterFp = null;
        if (returnFocus && ticketLetterBtn && !ticketLetterBtn.hidden) {
            ticketLetterBtn.focus();
        }
        startTicketStampDwell(ticketItems[ticketIndex]);
        resumeTicketReplayFromOverlay();
    }

    function downloadTicketLetter() {
        if (!ticketLetterBlobUrl) return;
        const a = document.createElement('a');
        a.href = ticketLetterBlobUrl;
        a.download = ticketLetterFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function shareTicketLetter() {
        if (!ticketLetterBlobUrl) return;
        const blob = await fetch(ticketLetterBlobUrl).then(r => r.blob());
        const file = new File([blob], ticketLetterFileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: ticketLetterFileName });
            } catch (e) { /* 用户取消分享无需处理 */ }
        }
    }

    // ================= 票根排序与坐标工具（重走 / 护照共用） =================
    function sortedTicketItems() {
        return ticketItems.slice().sort(compareTicketByTime);
    }

    function ticketTimeKey(fp) {
        return String((fp && (fp.ticketDate || fp.createTime)) || '');
    }

    function ticketNameKey(fp) {
        return String((fp && (fp.name || fp.ticketTitle)) || '');
    }

    // 全局统一的时间线排序：ticketDate || createTime 升序；
    // 两个字段都缺失的票排到最后（空串 localeCompare 最小，直接字符串比较会把它排到最前）；
    // 同值按名称、key 兜底，保证重走/护照各功能顺序一致。
    function compareTicketByTime(a, b) {
        const ka = ticketTimeKey(a);
        const kb = ticketTimeKey(b);
        if (!ka && kb) return 1;
        if (ka && !kb) return -1;
        const byDate = ka.localeCompare(kb);
        if (byDate) return byDate;
        const byName = ticketNameKey(a).localeCompare(ticketNameKey(b), 'zh-Hans-CN');
        if (byName) return byName;
        return String((a && a.key) || '').localeCompare(String((b && b.key) || ''));
    }

    function ticketHasCoordinate(fp) {
        if (!fp) return false;
        const rawLng = fp.lng;
        const rawLat = fp.lat;
        // 空值不能走 Number()：Number(null) / Number('') 都是 0，会被误判成有效坐标
        if (rawLng === '' || rawLng == null || rawLat === '' || rawLat == null) return false;
        const lng = Number(rawLng);
        const lat = Number(rawLat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
        // (0, 0) 是后台表单未填写坐标时的默认值，视为没有定位
        return !(lng === 0 && lat === 0);
    }

    // 同城判定：优先比 adcode，没有 adcode 才比城市名；
    // 两边都得有值，否则城市为空的票根会被误判成“同一城市”，整场放映一次都不飞。
    function isSameTicketCity(a, b) {
        const codeA = String((a && a.cityAdcode) || '').trim();
        const codeB = String((b && b.cityAdcode) || '').trim();
        if (codeA && codeB) return codeA === codeB;
        const cityA = String((a && a.city) || '').trim();
        const cityB = String((b && b.city) || '').trim();
        return !!cityA && cityA === cityB;
    }

    // ================= 重走一遍（阶段 D） =================
    function updateTicketReplayPlayButton() {
        if (ticketReplayPlay) {
            ticketReplayPlay.textContent = ticketReplayPlaying ? '暂停' : '继续';
        }
    }

    function updateTicketReplaySpeedButton() {
        if (!ticketReplaySpeed) return;
        ticketReplaySpeed.textContent = ticketReplaySpeedValue + '×';
        ticketReplaySpeed.setAttribute('aria-label', '播放速度，当前 ' + ticketReplaySpeedValue + ' 倍速');
        ticketReplaySpeed.classList.toggle('is-on', ticketReplaySpeedValue > 1);
    }

    function toggleTicketReplaySpeed() {
        ticketReplaySpeedValue = ticketReplaySpeedValue > 1 ? 1 : 2;
        updateTicketReplaySpeedButton();
        // 正在放映就按新倍速重排下一段（当前停留重新计时，不跳站）
        if (ticketReplayPlaying) scheduleNextTicketReplay();
        if (ticketReplayEta) ticketReplayEta.textContent = ticketReplayRemainingText();
    }

    // 剩余时间：按「停留 + 飞行 + 落卡停顿」的整段估算，同城/缺坐标的段会更快，所以标「约」
    function ticketReplayRemainingText() {
        const len = ticketReplayPoints.length;
        const left = Math.max(0, len - 1 - ticketReplayIndex);
        if (!left) return '';
        const perStopMs = (TICKET_REPLAY_DWELL_MS + 2300 + 480) / ticketReplaySpeedValue;
        const seconds = Math.round(left * perStopMs / 1000);
        return '剩余约 ' + (seconds >= 90 ? Math.round(seconds / 60) + ' 分钟' : seconds + ' 秒');
    }

    function ticketReplayFlyTo(fp, duration, onDone) {
        if (!fp || !ticketHasCoordinate(fp)) {
            // 没有坐标时不飞：仍回调，避免调用方把 ticketReplayFlying 卡在 true
            if (onDone) onDone();
            return;
        }
        const target = Cesium.Cartesian3.fromDegrees(Number(fp.lng), Number(fp.lat), 150000);
        const dur = reduceMotion ? 0 : Math.max(0, duration || 0);
        if (dur <= 0) {
            viewer.camera.flyTo({ destination: target, duration: 0 });
            if (onDone) onDone();
            return;
        }
        viewer.camera.flyTo({
            destination: target,
            duration: dur,
            complete: onDone || undefined,
            cancel: onDone || undefined
        });
    }

    // 相机飞行是异步的：暂停/改站/退出时必须显式取消，
    // 否则镜头会继续飞向已经放弃的目标（票夹已经回来了，地球还在动）
    function cancelTicketReplayFlight() {
        try {
            viewer.camera.cancelFlight();
        } catch (e) {
            /* 相机未在飞行或场景尚未就绪时忽略 */
        }
    }

    function ticketReplayShowStop(index, animate) {
        const points = ticketReplayPoints;
        if (!points.length) return;
        const len = points.length;
        ticketReplayIndex = Math.max(0, Math.min(index, len - 1));
        const fp = points[ticketReplayIndex];
        // 放映期间不改写票夹游标；退出时由 clearTicketReplay 复位到进入前的票根

        ticketReplayCard.classList.remove('is-arriving', 'is-missing');
        ticketReplayCard.innerHTML = '';
        const img = document.createElement('img');
        img.alt = fp.ticketTitle || fp.name || '票根';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.onerror = () => {
            ticketReplayCard.classList.add('is-missing');
            ticketReplayCard.textContent = (fp.city || fp.name || '?').charAt(0);
        };
        img.src = ticketImageUrl(fp.ticketImage);
        ticketReplayCard.appendChild(img);
        if (animate) {
            void ticketReplayCard.offsetWidth;
            ticketReplayCard.classList.add('is-arriving');
        }

        const meta = ticketMeta(fp);
        ticketReplaySubtitle.textContent = [fp.name || meta.title, fp.city || meta.route, meta.date]
            .filter(Boolean).join(' · ');
        // 时间有色：氛围色跟随当前放映到的那一张票根
        applyTicketSeason(fp);
        // 第二行拆成「状态文字 + 里程数字」两块：数字单独给强调色与等宽数字，移动中更醒目
        let routeText;
        let distanceText = '';
        if (ticketReplayIndex === 0) {
            routeText = ticketHasCoordinate(fp) ? '旅程起点' : '旅程起点 · 这张票根没有定位';
        } else {
            const prev = points[ticketReplayIndex - 1];
            const sameCity = isSameTicketCity(prev, fp);
            const noCoord = !ticketHasCoordinate(prev) || !ticketHasCoordinate(fp);
            if (noCoord) {
                routeText = '上一站无法定位，原地淡入下一张';
            } else if (sameCity) {
                routeText = '与上一站同一城市，原地停留';
            } else {
                routeText = '沿着上一站的方向继续';
                distanceText = '距上一站 ' + Math.round(haversineKm(prev, fp)).toLocaleString('zh-CN') + ' km';
            }
        }
        ticketReplayRoute.textContent = routeText;
        if (ticketReplayDistance) {
            ticketReplayDistance.textContent = distanceText;
        }
        // 同城角标：这座城市在本次重走里有多张票根时，标出这是第几张
        if (ticketReplayCityBadge) {
            const key = cityKeyOf(fp);
            let badge = '';
            if (key) {
                const group = ticketReplayPoints.filter(item => cityKeyOf(item) === key);
                if (group.length > 1) {
                    const position = group.indexOf(fp) + 1;
                    badge = (String(fp.city || '').trim() || '同城') + ' · 同城 ' + position + '/' + group.length;
                }
            }
            ticketReplayCityBadge.textContent = badge;
            ticketReplayCityBadge.hidden = !badge;
        }
        const totalKm = ticketReplayKilometers(ticketReplayIndex);
        ticketReplayProgressText.textContent = (ticketReplayIndex + 1) + ' / ' + len;
        // 累计里程和「距上一站」放在同一行，进度区只留进度与剩余时间
        if (ticketReplayTotal) {
            ticketReplayTotal.textContent = totalKm > 0
                ? '累计 ' + Math.round(totalKm).toLocaleString('zh-CN') + ' km'
                : '';
        }
        if (ticketReplayEta) {
            ticketReplayEta.textContent = ticketReplayRemainingText();
        }
        if (ticketReplayBarInner) {
            /* 进度条走 transform: scaleX，别动 width（宽度动画会触发重排） */
            ticketReplayBarInner.style.transform = 'scaleX(' + ((ticketReplayIndex + 1) / len) + ')';
        }
        // 预加载下一张，避免飞行落地后才开始解码
        const next = points[ticketReplayIndex + 1];
        if (next) {
            const pre = new Image();
            pre.src = ticketImageUrl(next.ticketImage);
        }
    }

    // 从第一张票根累加到第 upTo 张的直线估算里程。
    // 缺坐标的段和「同城段」都跳过：界面上这两类段也不显示里程，累计口径保持一致
    function ticketReplayKilometers(upTo) {
        const points = ticketReplayPoints;
        const end = Math.min(upTo, points.length - 1);
        let km = 0;
        for (let i = 1; i <= end; i++) {
            const from = points[i - 1];
            const to = points[i];
            if (!ticketHasCoordinate(from) || !ticketHasCoordinate(to)) continue;
            if (isSameTicketCity(from, to)) continue;
            km += haversineKm(from, to);
        }
        return km;
    }

    function ticketReplayShowFlight(from, to, kmValue, flightSeconds) {
        if (!ticketReplayFlight) return;
        if (ticketReplayView) ticketReplayView.classList.add('is-flying');
        // 进度条动画时长跟着实际飞行时长走（变速时同步）
        ticketReplayFlight.style.setProperty('--flight-duration', (flightSeconds || 2.3) + 's');
        const km = kmValue ? Math.round(kmValue).toLocaleString('zh-CN') + ' km' : '';
        ticketReplayFlightLabel.textContent = '正在飞往';
        if (ticketReplayFlightFrom) {
            ticketReplayFlightFrom.textContent = (from && (from.city || from.name)) || '上一站';
        }
        ticketReplayFlightCity.textContent = to.city || to.name || '下一站';
        ticketReplayFlightKm.textContent = km ? '约 ' + km + ' · 直线估算' : '';
        // 每次起飞都重放一次进度条：先摘掉 is-on 再强制重排
        ticketReplayFlight.classList.remove('is-on');
        void ticketReplayFlight.offsetWidth;
        ticketReplayFlight.classList.add('is-on');
        ticketReplayFlight.setAttribute('aria-hidden', 'false');
        // 底部影院条同步跟着走：状态行说去哪个城市，里程行显示这一段
        if (ticketReplayRoute) {
            ticketReplayRoute.textContent = '正在飞往 ' + (to.city || to.name || '下一站');
        }
        if (ticketReplayDistance) {
            ticketReplayDistance.textContent = km ? '约 ' + km : '';
        }
    }

    function ticketReplayHideFlight() {
        if (ticketReplayFlight) {
            ticketReplayFlight.classList.remove('is-on');
            ticketReplayFlight.setAttribute('aria-hidden', 'true');
        }
        if (ticketReplayView) ticketReplayView.classList.remove('is-flying');
    }

    // 票根放大 / 收起：只有用户明确点票根才会放大（方案 A）
    function ticketReplaySetZoom(zoom) {
        if (!ticketReplayView || !ticketReplayCard) return;
        ticketReplayView.classList.toggle('is-focused', !!zoom);
        ticketReplayCard.setAttribute('aria-expanded', zoom ? 'true' : 'false');
        ticketReplayCard.setAttribute('aria-label', zoom ? '收起票根' : '放大票根');
    }

    function toggleTicketReplayZoom() {
        if (ticketViewMode !== 'replay' || !ticketReplayCard) return;
        // 飞行途中卡片是淡出的，这时不允许（键盘）触发放大
        if (ticketReplayView.classList.contains('is-flying')) return;
        const zoomed = ticketReplayView.classList.contains('is-focused');
        if (zoomed) {
            ticketReplaySetZoom(false);
            return;
        }
        // 点票根的意思就是「停下来让我看清这张」：正在放映就先暂停
        if (ticketReplayPlaying) pauseTicketReplay();
        ticketReplaySetZoom(true);
    }

    function scheduleNextTicketReplay() {
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        if (!ticketReplayPlaying || ticketViewMode !== 'replay') return;
        const gen = ticketReplayGeneration;
        const rate = ticketReplaySpeedValue;
        ticketReplayTimer = setTimeout(() => {
            if (gen !== ticketReplayGeneration || !ticketReplayPlaying || ticketReplayFlying) return;
            const points = ticketReplayPoints;
            const next = ticketReplayIndex + 1;
            if (next >= points.length) {
                finishTicketReplay();
                return;
            }
            const from = points[ticketReplayIndex];
            const to = points[next];
            const sameCity = isSameTicketCity(from, to);
            const noCoord = !ticketHasCoordinate(from) || !ticketHasCoordinate(to);
            if (sameCity || noCoord) {
                ticketReplayTimer = setTimeout(() => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayHideFlight();
                    ticketReplayShowStop(next, true);
                    scheduleNextTicketReplay();
                }, 520 / rate);
            } else {
                const km = haversineKm(from, to);
                const flightSeconds = 2.3 / rate;
                ticketReplayFlying = true;
                ticketReplayShowFlight(from, to, km, flightSeconds);
                ticketReplayFlyTo(to, flightSeconds, () => {
                    if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                    ticketReplayFlying = false;
                    ticketReplayTimer = setTimeout(() => {
                        if (gen !== ticketReplayGeneration || !ticketReplayPlaying) return;
                        ticketReplayHideFlight();
                        ticketReplayShowStop(next, true);
                        scheduleNextTicketReplay();
                    }, 480 / rate);
                });
            }
        }, TICKET_REPLAY_DWELL_MS / rate);
    }

    function pauseTicketReplay() {
        if (!ticketReplayPlaying) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        ticketReplayFlying = false;
        cancelTicketReplayFlight();
        ticketReplayHideFlight();
        // 方案 A：暂停只冻结当前画面，不再把票根搬到画面中央
        if (ticketReplayView) ticketReplayView.classList.add('is-paused');
        updateTicketReplayPlayButton();
    }

    function resumeTicketReplay() {
        if (ticketReplayPlaying || !ticketReplayPoints.length || ticketViewMode !== 'replay') return;
        if (!ticketReplayEnd.hidden) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = true;
        updateTicketReplayPlayButton();
        if (ticketReplayView) ticketReplayView.classList.remove('is-paused');
        ticketReplaySetZoom(false);
        ticketReplayShowStop(ticketReplayIndex, false);
        scheduleNextTicketReplay();
    }

    // 抽票/护照/明信片浮层打开时暂停放映，关闭后接着播，不丢播放位置
    function pauseTicketReplayForOverlay() {
        if (ticketViewMode !== 'replay' || !ticketReplayPlaying) return;
        ticketReplayPausedByOverlay = true;
        pauseTicketReplay();
    }

    function resumeTicketReplayFromOverlay() {
        if (!ticketReplayPausedByOverlay) return;
        ticketReplayPausedByOverlay = false;
        if (ticketViewMode !== 'replay' || !ticketGallery.classList.contains('show')) return;
        if (!ticketReplayEnd.hidden) return;
        resumeTicketReplay();
    }

    // 手动上一站/下一站：卡片立即切换，同时把镜头带到这一站（缺坐标时保持原地）
    function ticketReplayFlyToStop(index) {
        const fp = ticketReplayPoints[index];
        if (!ticketHasCoordinate(fp)) return;
        ticketReplayFlyTo(fp, 1.4, null);
    }

    function stepTicketReplay(delta) {
        if (!ticketReplayPoints.length || !ticketReplayEnd.hidden) return;
        const wasPlaying = ticketReplayPlaying;
        pauseTicketReplay();
        const len = ticketReplayPoints.length;
        const next = (ticketReplayIndex + delta + len) % len;
        // 播放中不重复触发落卡动画：紧接着的 resume 会重绘当前卡片
        ticketReplayShowStop(next, !wasPlaying);
        ticketReplayFlyToStop(next);
        if (wasPlaying) resumeTicketReplay();
    }

    function finishTicketReplay() {
        if (!ticketReplayEnd) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        ticketReplayFlying = false;
        ticketReplayHideFlight();
        updateTicketReplayPlayButton();
        const points = ticketReplayPoints;
        const km = ticketReplayKilometers(points.length - 1);
        const cities = new Set(points.map(fp => fp.city).filter(Boolean));
        const first = points[0];
        const last = points[points.length - 1];
        const stamp = fp => {
            const raw = String(fp.ticketDate || fp.createTime || '').slice(0, 10);
            return raw ? raw.replace(/-/g, '.') : '';
        };
        const yearOf = fp => Number(String(fp.ticketDate || fp.createTime || '').slice(0, 4));
        const yearA = yearOf(first);
        const yearB = yearOf(last);
        if (ticketReplayEndRange) {
            const from = stamp(first);
            const to = stamp(last);
            ticketReplayEndRange.textContent = (from && to && from !== to) ? from + ' → ' + to : (from || '');
        }
        if (ticketReplayEndTickets) ticketReplayEndTickets.textContent = String(points.length);
        if (ticketReplayEndCities) ticketReplayEndCities.textContent = cities.size ? String(cities.size) : '—';
        if (ticketReplayEndKm) ticketReplayEndKm.textContent = Math.round(km).toLocaleString('zh-CN');
        if (ticketReplayEndSpan) {
            ticketReplayEndSpan.textContent = (yearA && yearB && yearB >= yearA)
                ? String(yearB - yearA + 1)
                : '—';
        }
        // 重走只放映「带票根图」的足迹，这里说明一下总数，免得用户以为别的足迹丢了
        if (ticketReplayEndNote) {
            const withoutTicket = Math.max(0, FOOTPRINTS.length - ticketItems.length);
            ticketReplayEndNote.textContent = withoutTicket
                ? '重走只放映有票根图的足迹，另有 ' + withoutTicket + ' 个足迹未附票根'
                : '';
            ticketReplayEndNote.hidden = !withoutTicket;
        }
        ticketReplayEnd.hidden = false;
        if (ticketReplayView) ticketReplayView.classList.add('is-ended');
        ticketReplayResumeIndex = 0;   // 已播完：下次进重走从头开始，而不是停在终点卡
    }

    function startTicketReplay(startIndex = 0) {
        if (!ticketReplayPoints.length) return;
        ticketReplayGeneration++;
        ticketReplayPlaying = true;
        ticketReplayFlying = false;
        const len = ticketReplayPoints.length;
        const start = Math.max(0, Math.min(Number(startIndex) || 0, len - 1));
        ticketReplayIndex = start;
        if (ticketReplayEnd) ticketReplayEnd.hidden = true;
        ticketReplayHideFlight();
        if (ticketReplayView) {
            ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
        }
        ticketReplaySetZoom(false);
        if (autoRotate) setAutoRotate(false);
        ticketReplayShowStop(start, true);
        if (ticketHasCoordinate(ticketReplayPoints[start])) {
            ticketReplayFlyTo(ticketReplayPoints[start], 0.001, null);
        }
        scheduleNextTicketReplay();
        updateTicketReplayPlayButton();
    }

    // 至少两张带经纬度的票根才能放映（入口按钮与进入校验共用同一条件）
    function canEnterTicketReplay() {
        return !!ticketReplayView && ticketItems.filter(ticketHasCoordinate).length >= 2;
    }

    function enterTicketReplay() {
        if (!ticketReplayView) return;
        ticketReplayItems = sortedTicketItems();
        ticketReplayPoints = ticketReplayItems;
        if (!canEnterTicketReplay()) return;
        updateTicketReplaySpeedButton();
        // 只在真正进入放映时记录一次：自动旋转状态与当前票根，退出时复位
        ticketReplayPrevAutoRotate = autoRotate;
        ticketReplayEntryIndex = ticketIndex;
        ticketGallery.classList.add('is-replay-mode');
        ticketReplayView.hidden = false;
        // 从票夹切回来时接着上次的站继续播（-1 表示从头开始）
        startTicketReplay(ticketReplayResumeIndex);
        updateTicketModeButtons();
    }

    function clearTicketReplay() {
        const wasReplay = ticketViewMode === 'replay';
        ticketReplayGeneration++;
        ticketReplayPlaying = false;
        ticketReplayFlying = false;
        clearTimeout(ticketReplayTimer);
        ticketReplayTimer = null;
        cancelTicketReplayFlight();
        ticketReplayHideFlight();
        if (ticketReplayEnd) ticketReplayEnd.hidden = true;
        if (ticketReplayView) ticketReplayView.hidden = true;
        if (ticketReplayView) ticketReplayView.classList.remove('is-focused', 'is-flying', 'is-paused', 'is-ended');
        ticketReplaySetZoom(false);
        if (ticketGallery) ticketGallery.classList.remove('is-replay-mode');
        // 回到进入放映前的票根，不停留在最后看过的那一张；
        // 只有真的在放映中才复位，避免之后切模式时把票夹游标拽回旧位置
        if (wasReplay) {
            // 记下播到哪一站：切回票夹再进来能接着播
            ticketReplayResumeIndex = ticketReplayIndex;
            if (ticketItems[ticketReplayEntryIndex]) ticketIndex = ticketReplayEntryIndex;
        }
        ticketReplayPausedByOverlay = false;
        if (ticketReplayPrevAutoRotate && !autoRotate) setAutoRotate(true);
        ticketReplayPrevAutoRotate = false;
        updateTicketReplayPlayButton();
    }

    function setTicketViewMode(mode) {
        if (mode === ticketViewMode) return;
        ensureTicketCityFilterCleared();
        clearTicketReplay();
        if (mode === 'replay') {
            // 先校验再改状态：不满足条件时保持票夹视图，避免模式卡在 replay
            if (!canEnterTicketReplay()) {
                ticketViewMode = 'archive';
                updateTicketModeButtons();
                return;
            }
            ticketViewMode = 'replay';
            clearTicketStampTimer();
            enterTicketReplay();
        } else {
            ticketViewMode = 'archive';
            clearTicketStampTimer();
            if (ticketItems[ticketIndex]) {
                applyTicketSeason(ticketItems[ticketIndex]);
            }
            renderTicketWallet();
            // 退出放映后把横向长串重新居中到入口票根，避免字幕与卷轴错位
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
            }
            updateTicketModeButtons();
            startTicketStampDwell(ticketItems[ticketIndex]);
            // 从重走回到票夹：自动旋转开着时同样把视角收回整个地球
            restoreGlobeViewForAutoRotate();
        }
    }

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
        return FOOTPRINTS.filter(fp =>
            ticketImageUrl(fp.ticketImage) &&
            (!ticketCityFilter || cityKeyOf(fp) === ticketCityFilter));
    }

    function ticketMeta(fp) {
        return {
            title: fp.name || fp.ticketTitle || '未命名足迹',
            subtitle: '',
            date: ticketDate(fp.ticketDate || fp.createTime),
            route: fp.city || '',
            province: fp.province || '',
            no: fp.ticketNo || '',
            type: fp.ticketType || fp.footprintType || '',
            description: fp.description || ''
        };
    }

    // 后台按行政区划代码记录城市/省份；前端据此补上不带声调的拼音。
    // 映射表由 district-pinyin.js 注入到 window.FOOTPRINT_PINYIN。
    function ticketPinyin(adcode) {
        if (!adcode || !window.FOOTPRINT_PINYIN) return '';
        const key = String(adcode || '').replace(/\.0+$/, '').padStart(6, '0');
        return window.FOOTPRINT_PINYIN[key] || '';
    }

    // 通过 /footprints?view=tickets 查询参数可直接进入票根页；
    // 打开/关闭时同步地址，浏览器前进/后退也能切换。
    function isTicketsView() {
        return new URLSearchParams(window.location.search).get('view') === 'tickets';
    }
    // 触屏设备上自动聚焦会触发 :focus-visible 描边，让“返回地球”看起来多了一圈边框；
    // 因此只在非触屏（键盘/鼠标）环境自动回焦，触屏交给用户自然操作。
    function focusTicketGalleryControl() {
        if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) return;
        // 刷新后直接进入票根页时还没有用户交互（userActivation），
        // 此时自动聚焦会让“返回地球”带出 :focus-visible 描边，因此跳过。
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        if (ticketGalleryBack) ticketGalleryBack.focus();
    }
    function setTicketView(open, targetIndex, startRotation) {
        if (!ticketGallery) return;
        if (open) {
            if (ticketViewMode !== 'archive') {
                clearTicketReplay();
                ticketViewMode = 'archive';
            }
            ticketReplayResumeIndex = -1;   // 重新打开票根页时，重走从头开始
            // 打开票根前自动收起可能开着的足迹详情卡 / 城市聚合卡
            if (markerCard && markerCard.classList.contains('visible')) hideMarkerCard();
            if (cityCard && cityCard.classList.contains('visible')) hideCityCard(false);
            // 卡片墙 / 城市图片墙是不透明浮层：先收起来，票根页才能透出背后的地球
            hideTicketUnderlay();
            ticketItems = ticketItemsFromFootprints();
            loadTicketPassport();
            updateTicketFeatureButtons();
            ticketGalleryEmpty.hidden = ticketItems.length > 0;
            const cities = new Set(ticketItems.map(fp => fp.city).filter(Boolean));
            const latest = ticketItems.map(fp => ticketDate(fp.ticketDate || fp.createTime)).filter(Boolean)[0] || '';
            ticketGalleryStats.textContent = ticketItems.length
                ? ticketItems.length + ' 张票根 · ' + (cities.size || '多个') + ' 个目的地' + (latest ? ' · 最近 ' + latest : '')
                : '收集每一次出发的凭证';
            ticketGallery.classList.add('show');
            setOverlayHidden(ticketGallery, false);
            document.body.classList.add('ticket-gallery-open');
            // 打开票根页时把地址同步为 ?view=tickets，便于分享/直达
            if (!isTicketsView()) history.pushState({ ticketGallery: true }, '', window.location.pathname + '?view=tickets');
            // 打开票根页：地球作为背景，若未开启自转则自动开启（从足迹卡进入时不开启）
            if (startRotation !== false && !autoRotate) setAutoRotate(true);
            if (ticketItems.length) {
                ticketIndex = targetIndex == null
                    ? 0
                    : Math.max(0, Math.min(targetIndex, ticketItems.length - 1));
                buildTicketWallet();
                renderTicketWallet();
                if (ticketStripMode) {
                    requestAnimationFrame(() => {
                        centerStripItem(ticketIndex, false);
                        positionStripArchive();
                    });
                }
                focusTicketGalleryControl();
            } else {
                resetTicketSeason();
                ticketWallet.hidden = true;
                ticketStrip.hidden = true;
                ticketStripHint.hidden = true;
                document.body.classList.remove('ticket-strip-active');
                focusTicketGalleryControl();
            }
        } else {
            // 关闭票根页时浮层会跟着关闭，这时不要再去恢复放映
            ticketReplayPausedByOverlay = false;
            if (ticketPassport && ticketPassport.classList.contains('show')) closeTicketPassport(false);
            if (ticketOracle && ticketOracle.classList.contains('show')) closeTicketOracle(false);
            if (ticketLetter && ticketLetter.classList.contains('show')) closeTicketLetter(false);
            if (ticketViewMode !== 'archive') {
                clearTicketReplay();
                ticketViewMode = 'archive';
            }
            // 返回地球：自动旋转开着时，把重走留下的近地面视角收回整个地球
            restoreGlobeViewForAutoRotate();
            // 先把焦点移出票根容器，再标记 aria-hidden，避免无障碍警告
            if (ticketGallery.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            const pendingFocus = ticketTrigger || ticketUnderlayFocus ||
                document.getElementById('ticketGalleryBtn');
            clearTicketStampTimer();
            resetTicketSeason();
            resetTicketCityFilter();   // 关掉票根页就清掉城市筛选，下次进来是全部票根
            // 把卡片墙 / 城市图片墙原样放回来（只恢复显隐，滚动位置一直是它自己的）
            restoreTicketUnderlay();
            ticketGallery.classList.remove('show');
            setOverlayHidden(ticketGallery, true);
            document.body.classList.remove('ticket-gallery-open');
            document.body.classList.remove('ticket-strip-active');
            ticketStripHint.hidden = true;
            // 关闭后还原地址，避免刷新又回到票根页
            if (isTicketsView()) history.replaceState({}, '', window.location.pathname);
            if (pendingFocus) {
                // 等导航栏恢复可见后再回焦，避免焦点落在隐藏元素上
                setTimeout(() => {
                    if (pendingFocus && pendingFocus.isConnected &&
                        getComputedStyle(pendingFocus).visibility !== 'hidden') {
                        pendingFocus.focus({ preventScroll: true });
                    }
                }, 80);
            }
        }
    }

    // 创建一张票根图片；两种展示样式共用加载/失败处理
    function createTicketImage(fp, i, className) {
        const originalUrl = ticketImageUrl(fp.ticketImage);
        // 同一张票根已成功加载过：直接复用原 img 元素，避免再次发起图片请求
        const pooled = originalUrl ? ticketImagePool.get(originalUrl) : null;
        if (pooled) {
            pooled.className = className;
            pooled.alt = fp.ticketTitle || fp.name || '';
            pooled.dataset.index = String(i);
            pooled.referrerPolicy = 'no-referrer';
            pooled.decoding = 'async';
            pooled.classList.add('is-loaded');
            pooled.classList.remove('is-error');
            return pooled;
        }

        const img = document.createElement('img');
        img.className = className;
        img.alt = fp.ticketTitle || fp.name || '';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.dataset.index = String(i);
        let triedHttps = false;
        img.onload = () => {
            img.classList.add('is-loaded');
            if (originalUrl) ticketImagePool.set(originalUrl, img);
            if (i === ticketIndex) {
                ticketLightboxLoading.hidden = true;
                ticketLightboxError.hidden = true;
            }
            // 长串样式：图片实际尺寸就绪后再补左右留白并让当前票根保持居中
            if (ticketStripMode) {
                updateStripPadding();
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
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
        return img;
    }

    // 按后台配置构建票夹或横向长串
    function buildTicketWallet() {
        // 保留已加载图片：下次打开时直接从 ticketImagePool 复用，不重新发请求
        walletItems = [];
        ticketGalleryHint.hidden = true;
        ticketStripProgress.hidden = true;
        ticketStripHint.hidden = true;
        document.body.classList.remove('ticket-strip-active');
        if (ticketStripMode) {
            const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
            ticketWallet.hidden = true;
            ticketStrip.hidden = false;
            ticketStripProgress.hidden = ticketItems.length < 2;
            ticketStripHint.hidden = ticketItems.length < 2;
            if (ticketItems.length) {
                document.body.classList.add('ticket-strip-active');
                // 移动端没有鼠标，改用滑动提示；桌面端隐藏顶部提示
                ticketGalleryHint.textContent = isTouch
                    ? '左右滑动切换票根'
                    : '滚动鼠标或拖动查看票根';
                ticketGalleryHint.hidden = !isTouch || ticketItems.length < 2;
            } else {
                ticketGalleryHint.hidden = true;
            }
            buildTicketStrip();
        } else {
            ticketWallet.hidden = false;
            ticketStrip.hidden = true;
            buildFanWallet();
        }
    }

    // 票夹：把每张票根叠成一层，第一张完整展示，后面的从边缘露出一条边。
    function buildFanWallet() {
        ticketWallet.innerHTML = '';
        walletItems = ticketItems.map((fp, i) => {
            const img = createTicketImage(fp, i, 'ticket-wallet-item');
            ticketWallet.appendChild(img);
            return { fp, img };
        });
        const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
        ticketGalleryHint.textContent = isTouch ? '左右滑动切换票根' : '点击票根或滚动鼠标切换';
        ticketGalleryHint.hidden = ticketItems.length < 2;
    }

    // 横向长串：所有票根排成一行，通过滚动/拖拽切换
    function buildTicketStrip() {
        ticketStripScroller.innerHTML = '';
        ticketStripScroller.scrollLeft = 0;
        walletItems = ticketItems.map((fp, i) => {
            const img = createTicketImage(fp, i, 'ticket-strip-item');
            ticketStripScroller.appendChild(img);
            return { fp, img };
        });
        updateStripPadding();
    }

    function renderTicketMeta(fp) {
        const meta = ticketMeta(fp);
        const titleText = ticketLightboxTitle.querySelector('.ticket-meta-title-text');
        if (titleText) titleText.textContent = meta.title;
        else ticketLightboxTitle.textContent = meta.title;
        ticketLightboxEnglish.textContent = fp.ticketEnglish || fp.ticketTitle || '';
        ticketLightboxEnglish.hidden = !ticketLightboxEnglish.textContent;
        if (ticketLightboxPinyin) {
            const cityPinyin = ticketPinyin(fp.cityAdcode);
            const provincePinyin = ticketPinyin(fp.provinceAdcode);
            const pinyinText = cityPinyin && provincePinyin && cityPinyin !== provincePinyin
                ? cityPinyin + ', ' + provincePinyin
                : (cityPinyin || provincePinyin || '');
            ticketLightboxPinyin.textContent = pinyinText;
            ticketLightboxPinyin.hidden = !pinyinText;
        }
        ticketLightboxSubtitle.textContent = '';
        ticketLightboxSubtitle.hidden = true;
        ticketLightboxDescription.textContent = meta.description || '风吹洱海，云落苍山，生活在别处，也在此刻。';
        ticketLightboxDescription.hidden = false;
        ticketLightboxDetails.innerHTML = [
            ['城市', meta.route, 'route', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>'],
            ['省份', meta.province, 'province', ''],
            ['日期', meta.date, 'date', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17"/></svg>'],
            ['票号', meta.no, 'no', '']
        ].filter(item => item[1]).map(item => '<div class="ticket-meta-field ticket-meta-field-' + item[2] + '">' + item[3] + '<dt>' + ticketEscape(item[0]) + '</dt><dd>' + ticketEscape(item[1]) + '</dd></div>').join('');
        ticketLightboxCount.textContent = (ticketIndex + 1) + ' / ' + ticketItems.length;
    }

    function renderTicketWallet() {
        const fp = ticketItems[ticketIndex];
        if (!fp) return;
        applyTicketSeason(fp);
        renderTicketMeta(fp);
        updateTicketStampBadge(fp, false);
        updateTicketLetterAction(fp);
        startTicketStampDwell(fp);
        if (ticketStripMode) {
            renderStripWallet();
        } else {
            renderFanWallet();
        }
        updateTicketFeatureButtons();
    }

    function renderFanWallet() {
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
                const dx = dir * (8 + k * 4);
                // 移动端保留扇形折叠（第2张约1.7°、后续最大2.8°），配合限高不戳出顶部
                const deg = window.matchMedia('(max-width: 900px)').matches
                    ? dir * Math.min(2.8, 0.6 + k * 1.1)
                    : dir * Math.min(1.2, 0.4 + k * 0.4);
                img.style.transform = 'translate(' + dx + 'px, 0) rotate(' + deg + 'deg)';
                img.style.zIndex = String(10 - distance);
                img.tabIndex = 0;
            }
        });
    }

    function renderStripWallet() {
        walletItems.forEach((item, i) => {
            const img = item.img;
            const active = i === ticketIndex;
            img.classList.toggle('is-active', active);
            img.setAttribute('aria-label', (i + 1) + ' / ' + walletItems.length + ' ' + (item.fp.ticketTitle || item.fp.name || '票根'));
            img.tabIndex = active ? -1 : 0;
        });
        const current = walletItems[ticketIndex] && walletItems[ticketIndex].img;
        ticketLightboxLoading.hidden = !current || current.classList.contains('is-loaded') || current.classList.contains('is-error');
        ticketLightboxError.hidden = !current || !current.classList.contains('is-error');
        renderStripProgress();
    }

    // 字幕下方的极简指示线：亮点在线上随当前票根位置移动，其余部分保持低透明度
    function renderStripProgress() {
        if (!ticketStripMode || !ticketStripProgress) return;
        const rail = ticketStripProgress.querySelector('.ticket-progress-rail');
        if (!rail) return;
        const total = ticketItems.length;
        rail.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const segment = document.createElement('button');
            segment.type = 'button';
            segment.className = 'ticket-progress-segment' + (i === ticketIndex ? ' is-current' : '');
            segment.dataset.index = String(i);
            segment.setAttribute('aria-label', '查看第 ' + (i + 1) + ' 张票根');
            segment.setAttribute('aria-current', i === ticketIndex ? 'true' : 'false');
            rail.appendChild(segment);
        }
    }

    function openTicketLightbox(index, trigger) {
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = Math.max(0, Math.min(index, ticketItems.length - 1));
        ticketTrigger = trigger || null;
        buildTicketWallet();
        renderTicketWallet();
        if (ticketStripMode) {
            requestAnimationFrame(() => {
                centerStripItem(ticketIndex, false);
                positionStripArchive();
            });
        }
        focusTicketGalleryControl();
    }

    function closeTicketLightbox(returnFocus = true) {
        if (!ticketLightbox) return;
        // 保留已加载图片供下次复用，避免每次打开票根都重新请求
        walletItems = [];
        setTicketView(false);
        if (returnFocus && ticketTrigger) ticketTrigger.focus();
        ticketTrigger = null;
    }

    function switchTicket(delta) {
        if (ticketItems.length < 2) return;
        ticketIndex = (ticketIndex + delta + ticketItems.length) % ticketItems.length;
        renderTicketWallet();
        if (ticketStripMode) centerStripItem(ticketIndex, true);
    }

    // ================= 横向长串：定位 / 吸附 / 拖拽 =================
    function stripViewportCenter() {
        const rect = ticketStripScroller.getBoundingClientRect();
        return rect.left + ticketStripScroller.clientWidth / 2;
    }

    function stripItemCenter(el) {
        const rect = el.getBoundingClientRect();
        return rect.left + rect.width / 2;
    }

    // 给首尾两张留出“能滚到居中”的左右留白：
    // 视口过宽时若不补白，中间票根的左右邻图永远无法滚到正中央，吸附会弹回中间。
    function updateStripPadding() {
        if (!ticketStripScroller.clientWidth || !ticketStripScroller.firstElementChild) return;
        const itemWidth = ticketStripScroller.firstElementChild.offsetWidth;
        if (!itemWidth) return;
        const pad = Math.max(0, Math.floor((ticketStripScroller.clientWidth - itemWidth) / 2));
        ticketStripScroller.style.paddingLeft = pad + 'px';
        ticketStripScroller.style.paddingRight = pad + 'px';
    }

    function nearestStripIndex() {
        const viewportCenter = stripViewportCenter();
        let best = 0;
        let bestDist = Infinity;
        walletItems.forEach((item, i) => {
            const el = item.img;
            if (!el || !el.offsetWidth) return;
            const dist = Math.abs(stripItemCenter(el) - viewportCenter);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        });
        return best;
    }

    function centerStripItem(index, smooth) {
        const item = walletItems[index];
        if (!item || !item.img || !ticketStripScroller.clientWidth) return;
        const el = item.img;
        const delta = stripItemCenter(el) - stripViewportCenter();
        const target = Math.max(0, ticketStripScroller.scrollLeft + delta);
        ticketStripScroller.scrollTo({
            left: target,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    function snapStrip() {
        if (!ticketStripMode || ticketItems.length < 2) return;
        const idx = nearestStripIndex();
        if (idx === ticketIndex) return;
        // 只在真正切换到另一张票根时，把新票根平滑吸附到视口正中央
        ticketIndex = idx;
        renderTicketWallet();
        centerStripItem(idx, true);
    }

    // 方案 1：票据档案页垫在当前票根下，只从票根下缘露出一截
    let stripArchiveRaf = null;
    function positionStripArchive() {
        if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
        // 字幕式元信息使用正常文档流，始终排在当前票根下方。
        ticketMetaPanel.style.position = '';
        ticketMetaPanel.style.left = '';
        ticketMetaPanel.style.top = '';
        ticketMetaPanel.style.zIndex = '';
        ticketStripScroller.style.marginBottom = '';
        ticketStripScroller.style.zIndex = '';
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
    ticketModeArchiveBtn.addEventListener('click', () => setTicketViewMode('archive'));
    ticketModeReplayBtn.addEventListener('click', () => setTicketViewMode('replay'));
    ticketReplayPrev.addEventListener('click', () => stepTicketReplay(-1));
    ticketReplayNext.addEventListener('click', () => stepTicketReplay(1));
    // 票根本体：点一下停下并放大，再点收起；键盘 Enter / 空格同样可用
    ticketReplayCard.addEventListener('click', toggleTicketReplayZoom);
    ticketReplayCard.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            toggleTicketReplayZoom();
        }
    });
    ticketReplaySpeed.addEventListener('click', toggleTicketReplaySpeed);
    ticketReplayOpen.addEventListener('click', openReplayTicketInArchive);
    // 清除城市筛选：回到全部票根
    ticketCityFilterChip.addEventListener('click', () => {
        resetTicketCityFilter();
        ticketItems = ticketItemsFromFootprints();
        ticketIndex = 0;
        buildTicketWallet();
        renderTicketWallet();
        updateTicketFeatureButtons();
    });
    ticketReplayPlay.addEventListener('click', () => {
        if (ticketReplayPlaying) pauseTicketReplay();
        else resumeTicketReplay();
    });
    ticketReplayExit.addEventListener('click', () => setTicketViewMode('archive'));
    ticketReplayAgain.addEventListener('click', () => startTicketReplay());
    ticketReplayCloseEnd.addEventListener('click', () => setTicketViewMode('archive'));
    ticketPassportBtn.addEventListener('click', openTicketPassport);
    ticketPassportBack.addEventListener('click', () => closeTicketPassport());
    ticketOracleBtn.addEventListener('click', openTicketOracle);
    ticketOracleBack.addEventListener('click', () => closeTicketOracle());
    ticketOracleAgain.addEventListener('click', ticketOracleShuffle);
    ticketOracleClose.addEventListener('click', () => closeTicketOracle());
    ticketOracleView.addEventListener('click', openOracleTicketInArchive);
    ticketLetterBtn.addEventListener('click', () => {
        const fp = ticketItems[ticketIndex];
        if (fp) openTicketLetter(fp);
    });
    ticketLetterBack.addEventListener('click', () => closeTicketLetter());
    ticketLetterDownload.addEventListener('click', downloadTicketLetter);
    ticketLetterShare.addEventListener('click', shareTicketLetter);
    ticketLetterRetry.addEventListener('click', () => { renderTicketLetter(); });
    ticketPassportReset.addEventListener('click', () => {
        if (!window.confirm('确定清除这台设备上的全部集章记录吗？')) return;
        ticketPassportRecords = [];
        persistTicketPassport();
        if (ticketPassport.classList.contains('show')) renderTicketPassport();
        updateTicketPassportButton();
        updateTicketStampBadge(ticketItems[ticketIndex], false);
    });
    [ticketPassport, ticketOracle, ticketLetter].forEach(overlay => {
        if (!overlay) return;
        overlay.addEventListener('click', event => {
            if (event.target !== overlay) return;
            if (overlay === ticketPassport) closeTicketPassport();
            else if (overlay === ticketOracle) closeTicketOracle();
            else closeTicketLetter();
        });
    });
    ticketLightboxRetry.addEventListener('click', () => reloadTicket(ticketIndex));
    ticketStripProgress.querySelector('.ticket-progress-rail').addEventListener('click', event => {
        const segment = event.target.closest('.ticket-progress-segment');
        if (!segment) return;
        const index = Number(segment.dataset.index);
        if (Number.isInteger(index)) {
            ticketIndex = index;
            renderTicketWallet();
            centerStripItem(ticketIndex, true);
        }
    });
    // 点露出的边缘 → 翻到前面；点当前票根 → 转到下一张
    ticketWallet.addEventListener('click', event => {
        if (walletSwiped) {
            walletSwiped = false;
            return;
        }
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
    // 触摸滑动切换（只在票根区域上滑动时切换，信息区滑动不切换）
    ticketWallet.addEventListener('touchstart', event => {
        walletTouchX = event.touches[0].clientX;
    }, { passive: true });
    ticketWallet.addEventListener('touchend', event => {
        if (walletTouchX === null) return;
        const dx = event.changedTouches[0].clientX - walletTouchX;
        walletTouchX = null;
        if (Math.abs(dx) > 40) {
            walletSwiped = true;
            switchTicket(dx < 0 ? 1 : -1);
            setTimeout(() => { walletSwiped = false; }, 400);
        }
    }, { passive: true });

    // 横向长串：鼠标滚轮（纵向滚动映射为横向）、拖拽滑动、停稳后吸附居中
    ticketStripScroller.addEventListener('wheel', event => {
        if (!ticketStripMode || ticketItems.length < 2) return;
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        ticketStripScroller.scrollLeft += delta;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 160);
    }, { passive: false });

    ticketStripScroller.addEventListener('pointerdown', event => {
        if (!ticketStripMode || ticketItems.length < 2) return;
        // 触屏交给浏览器原生滚动 + scroll-snap，手感更顺滑；手动拖拽只用于鼠标
        if (event.pointerType !== 'mouse') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        stripDrag = {
            id: event.pointerId,
            startX: event.clientX,
            startLeft: ticketStripScroller.scrollLeft,
            moved: false
        };
        ticketStripScroller.classList.add('dragging');
        try {
            ticketStripScroller.setPointerCapture(event.pointerId);
        } catch (e) {
            /* 忽略捕获失败 */
        }
    });
    ticketStripScroller.addEventListener('pointermove', event => {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const dx = event.clientX - stripDrag.startX;
        if (Math.abs(dx) > 5) stripDrag.moved = true;
        ticketStripScroller.scrollLeft = stripDrag.startLeft - dx;
    });
    function endStripDrag(event) {
        if (!stripDrag || stripDrag.id !== event.pointerId) return;
        const wasMoved = stripDrag.moved;
        stripDrag = null;
        ticketStripScroller.classList.remove('dragging');
        if (wasMoved) snapStrip();
    }
    ticketStripScroller.addEventListener('pointerup', endStripDrag);
    ticketStripScroller.addEventListener('pointercancel', endStripDrag);
    // 横条滚动时让档案页跟随当前主票根移动
    ticketStripScroller.addEventListener('scroll', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show')) return;
        clearTimeout(stripScrollTimer);
        stripScrollTimer = setTimeout(snapStrip, 180);
        if (stripArchiveRaf) return;
        stripArchiveRaf = requestAnimationFrame(() => {
            stripArchiveRaf = null;
            positionStripArchive();
        });
    }, { passive: true });
    window.addEventListener('resize', () => {
        if (!ticketStripMode || !ticketGallery.classList.contains('show') || ticketItems.length < 2) return;
        updateStripPadding();
        requestAnimationFrame(() => {
            centerStripItem(ticketIndex, false);
            positionStripArchive();
        });
    });

    // 票根页背景点击：票夹里点空白 = 返回地球（原有设计）。
    // 重走时不能沿用：重走层是 pointer-events: none 的点击穿透层，点空白会打到这里，
    // 于是"点一下地球"就误退到地球并丢掉正在放的那一段。
    ticketLightbox.addEventListener('click', event => {
        if (event.target !== ticketLightbox) return;
        if (ticketViewMode === 'replay') {
            // 重走里点空白：只在放大状态下收回票根，其它什么都不做
            if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                ticketReplaySetZoom(false);
            }
            return;
        }
        closeTicketLightbox();
    });
    document.addEventListener('keydown', event => {
        if (ticketOracle && ticketOracle.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketOracle();
            return;
        }
        if (ticketLetter && ticketLetter.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketLetter();
            return;
        }
        if (ticketPassport && ticketPassport.classList.contains('show') && event.key === 'Escape') {
            event.preventDefault();
            closeTicketPassport();
            return;
        }
        if (ticketGallery.classList.contains('show') && ticketViewMode === 'replay') {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                stepTicketReplay(event.key === 'ArrowRight' ? 1 : -1);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                // 分层关闭：先收回放大的票根，再退出重走
                if (ticketReplayView && ticketReplayView.classList.contains('is-focused')) {
                    ticketReplaySetZoom(false);
                    return;
                }
                setTicketViewMode('archive');
                return;
            }
        }
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
    // 页面切到后台时停止放映：后台标签页会节流定时器，回来容易一次跳好几站
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden || ticketViewMode !== 'replay') return;
        if (!ticketGallery.classList.contains('show')) return;
        pauseTicketReplay();
    });
    document.addEventListener('footprints:loaded', () => {
        if (ticketGallery.classList.contains('show')) {
            ticketItems = ticketItemsFromFootprints();
            ticketIndex = 0;
            buildTicketWallet();
            renderTicketWallet();
            if (ticketStripMode) {
                requestAnimationFrame(() => {
                    centerStripItem(ticketIndex, false);
                    positionStripArchive();
                });
            }
        }
    });
    // 浏览器前进/后退：按 ?view=tickets 参数在票根页与地球页之间切换
    window.addEventListener('popstate', () => {
        setTicketView(isTicketsView());
    });
    // 直接访问 /footprints?view=tickets 时打开票根页（数据就绪后再打开，避免空状态闪烁）
    if (isTicketsView()) {
        document.addEventListener('footprints:loaded', () => {
            if (!ticketGallery.classList.contains('show')) setTicketView(true);
        }, { once: true });
    }

    const chinaDataSource = Cesium.GeoJsonDataSource.load(
        '/plugins/footprint/assets/static/data/china-full.json',
        {
            fill: Cesium.Color.PALETURQUOISE.withAlpha(0) // 填充颜色（设为透明）
        }
    );

    chinaDataSource.then(dataSource => {
        chinaBoundarySource = dataSource;
        dataSource.show = false;   // 默认隐藏，放大到国内范围后由 updateIntroVisibility 显示

        // 由于 Cesium 的 strokeWidth 在复杂边界上可能渲染不佳，
        // 为每个多边形单独绘制一条折线来精确控制边界样式
        const entities = dataSource.entities.values;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            if (entity.polygon) {
                entity.polygon.outline = false;   // 边界已用独立折线绘制，禁用 polygon outline
                entity.polyline = {
                    positions: entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions,
                    width: 0.5,
                    material: Cesium.Color.WHITE
                };
            }
        }
        viewer.dataSources.add(dataSource);
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
