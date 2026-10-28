/**
 * 顶部导航与左侧标题卡。
 *
 * 三件事合在一起，因为它们共享同一套元素与显隐状态：
 *   - 标题卡 / 导航栏：按相机高度与当前场景（3D/2D/覆盖层）逐帧校正显隐；
 *   - 状态栏：底图坐标系、地形状态、足迹数；
 *   - 导航交互：底图菜单、工具溢出菜单、Esc 逐级关闭浮层。
 *
 * 高度阈值（INTRO_*、BOUNDARY_*、CITY_LABEL_*）也在这里定义 ——
 * 它们是「什么时候显示什么」的唯一来源。
 */

import { isAmapMode } from './view-mode.js';
import { setCityFillVisible } from './city-fill.js';
import {
    syncMarkerModeByHeight,
    hideMarkerCard,
    hideCityCard,
    hideDetailCardsForIntro,
    areDetailCardsReady,
    markerCard,
    cityCard
} from './markers.js';
import { isProvinceCardsActive, closeProvinceCards, cancelAllCityFlight, isProvinceAllFlying, syncProvinceAllAvailability, maybeShowProvinceHint } from './province-cards.js';
import { isPhotoRingViewing, exitPhotoRingView, isPhotoRingActive, hidePhotoRing, switchPhotoRingView } from './photo-ring.js';
import { lightbox, closeLightbox, switchLightbox } from './lightbox.js';
import { closePostcard, postcardPreview, closeTimeCapsule, timeCapsule, closeInsight, insightView } from './creative-overlays.js';
import { cityView, closeCityView } from './city-view.js';
import { cityWall, closeCityWall } from './city-wall.js';
import {
    isAutoRotating,
    refreshAutoRotate,
    setTicketGlobeAutoRotate
} from './auto-rotate.js';
import { tdtTodayUsage } from './tianditu-usage.js';

let deps = null;

let terrainNote = '';   // 由 setupNavigation 按是否配置天地图 Key 初始化

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.viewer                 () => Cesium.Viewer
 * @param d.reduceMotion           () => boolean
 * @param d.applyScreenSpaceError  () => void
 * @param d.footprints             () => Footprint[]
 * @param d.baseProviders          () => Record<string, provider>
 * @param d.currentBaseKey         () => string | null
 * @param d.statusText / d.statusRetry  () => HTMLElement
 * @param d.hasTdtKey              () => boolean
 * @param d.footprintCfg           () => object
 */
export function setupNavigation(d) {
    deps = d;
    terrainNote = d.hasTdtKey() ? '，未启用三维地形' : '，未配置天地图 Key（无地形）';
}

// ================= 左侧标题卡（仅 3D，整球视图显示） =================
const pageIntro = document.getElementById('pageIntro');
// 开发热更新期间可能短暂出现「新 JS + 旧模板」；主题覆盖也可能保留旧 #topNav。
// 先兼容旧节点，避免单个缓存错位让整页渲染直接中断。
const topNav = document.getElementById('footprintToolbar') ||
    document.getElementById('topNav');
const contentDock = document.getElementById('footprintContentDock');
const navTools = document.getElementById('navTools');
const navMoreBtn = document.getElementById('navMoreBtn');
const backGlobeBtn = document.getElementById('backGlobeBtn');   // 放大后显示，一键回球
export const cityFillFloatBtn = document.getElementById('cityFillFloatBtn');   // 旧模板兼容；新模板只在工具面板里保留城市高亮
// 相机高度（米）：高于 SHOW 时显示（能看到整个地球），低于 HIDE 时隐藏；
// 两个值必须拉开一段（回滞区间），否则在阈值附近轻微缩放就会来回闪烁。
const INTRO_SHOW_HEIGHT = 10500000;
const INTRO_HIDE_HEIGHT = 9500000;
let introVisible = false;
let entranceActive = false;   // 开场动画进行中（暂缓标题卡显示）

// 中国边界线：仅在放大到国内范围时显示，首屏整球视图保持干净。
// 低于 SHOW 高度显示，高于 HIDE 高度隐藏；同样留出回滞区间防闪烁。
const BOUNDARY_SHOW_HEIGHT = 9500000;
// 轮廓收起必须与"整球标题卡出现"在同一个高度：原来写死 11,000,000，
// 而标题卡 10,500,000 就显示，10.5M~11M 这段会出现"标题卡已出、轮廓与城市高亮还在"，
// 并且 activateAllCityCards() 看到 boundaryVisible 仍为 true，会跳过自动缩放直接展开。
// 取 INTRO_SHOW_HEIGHT 后两者同时翻转，回滞区间（9.5M~10.5M）内也互斥。
const BOUNDARY_HIDE_HEIGHT = INTRO_SHOW_HEIGHT;
let chinaBoundarySource = null;
let boundaryVisible = false;
// 城市名的显示层级比中国轮廓更深一档：轮廓刚出现时（整球仍占大半屏）不铺名字，
// 再放大到区域尺度才标注城市。想让它更早/更晚出现，改这两个常量即可。
const CITY_LABEL_SHOW_HEIGHT = 4000000;
const CITY_LABEL_HIDE_HEIGHT = 5000000;
let cityLabelVisible = false;


// 逐帧要读的三个浮层元素：第一次取到后缓存，省掉每帧三次 getElementById。
// 这里用惰性取值而不是直接引用变量 —— 这几个元素是在本函数之后才声明的（避免 TDZ）。
let introOverlayEls = null;
function introOverlayElements() {
    if (!introOverlayEls) {
        introOverlayEls = [
            document.getElementById('cityView'),
            document.getElementById('cityWall'),
            document.getElementById('ticketGallery'),
            document.getElementById('memoryShelf')
        ];
    }
    return introOverlayEls;
}

function updateIntroVisibility() {
    // 开场动画期间：标题卡暂缓显示，动画结束后由下一帧的相机高度逻辑自动显示
    if (entranceActive) {
        if (introVisible) {
            introVisible = false;
            pageIntro.classList.remove('visible');
        }
        topNav.classList.add('visible');
        contentDock?.classList.add('visible');
        document.body.classList.remove('nav-zoom');
        backGlobeBtn.disabled = true;
        return;
    }
    // 全屏覆盖层（城市卡片墙 / 城市足迹 / 票根）打开时隐藏顶部导航栏与标题卡，避免遮挡；
    // 这里用 getElementById 动态判断，避免引用后置声明的变量（TDZ）。
    const [cityViewEl, cityWallEl, ticketGalleryEl, memoryShelfEl] = introOverlayElements();
    const overlayOpen = !!(cityViewEl && cityViewEl.classList.contains('show')) ||
        !!(cityWallEl && cityWallEl.classList.contains('show')) ||
        !!(ticketGalleryEl && ticketGalleryEl.classList.contains('show')) ||
        document.body.classList.contains('memory-shelf-open') ||
        !!(memoryShelfEl && memoryShelfEl.classList.contains('show'));
    if (overlayOpen) {
        if (introVisible) {
            introVisible = false;
            pageIntro.classList.remove('visible');
        }
        topNav.classList.remove('visible');
        contentDock?.classList.remove('visible');
        document.body.classList.remove('nav-zoom');
        navTools.classList.remove('open');
        topNav.classList.remove('tools-open');
        document.body.classList.remove('footprint-tools-open');
        navMoreBtn.setAttribute('aria-expanded', 'false');
        backGlobeBtn.disabled = true;
        return;
    }
    // 2D 高德视图：导航栏常驻（保证 2D/3D 切换按钮可用），地球标题卡/浮动按钮隐藏
    if (isAmapMode()) {
        pageIntro.classList.remove('visible');
        topNav.classList.add('visible');
        contentDock?.classList.add('visible');
        document.body.classList.remove('nav-zoom');
        backGlobeBtn.disabled = true;
        return;
    }
    // 相机高度每帧只取一次：positionCartographic 每次调用都会新建 Cartographic 并做坐标换算，
    // 而下面三处判断（标题卡分层、边界与城市名分层、聚合切换）用的是同一个值。
    const cameraHeight = deps.viewer().camera.positionCartographic.height;
    // 2D / Columbus / 变形过程中标题一律隐藏；导航栏保留（否则 2D 下无法切回 3D）
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) {
        if (introVisible) {
            introVisible = false;
            pageIntro.classList.remove('visible');
        }
        topNav.classList.add('visible');
        contentDock?.classList.add('visible');
        document.body.classList.remove('nav-zoom');
        backGlobeBtn.disabled = true;
    } else {
        const h = cameraHeight;
        if (!introVisible && h > INTRO_SHOW_HEIGHT) {
            introVisible = true;
            pageIntro.classList.add('visible');
            // 回到整球视图时复位“工具”溢出菜单，避免残留展开态
            navTools.classList.remove('open');
            topNav.classList.remove('tools-open');
            document.body.classList.remove('footprint-tools-open');
            navMoreBtn.setAttribute('aria-expanded', 'false');
            if (areDetailCardsReady()) {
                // 回到整球视图时自动关闭详情卡：标题卡就在左下角，卡片不收会和它叠在一起；
                // 城市聚合卡同样会挡住标题卡，所以不能只收足迹卡。
                hideDetailCardsForIntro();
                // 省份城市卡片组同理：整球视图下省份已经不可点，留着只会挡标题卡
                if (isProvinceCardsActive()) closeProvinceCards();
            }
        } else if (introVisible && h < INTRO_HIDE_HEIGHT) {
            introVisible = false;
            pageIntro.classList.remove('visible');
        }
        // 导航常驻：整球视图显示全部工具；放大后保留 2D/票根/回到整球等入口。
        // 每次渲染都按当前相机高度校正状态，覆盖层关闭后也能自动恢复。
        topNav.classList.add('visible');
        contentDock?.classList.add('visible');
        document.body.classList.toggle('nav-zoom', !introVisible);
        // 视图组始终可见：整球态保持禁用，放大后启用“整球视角”。
        backGlobeBtn.disabled = introVisible;
    }

    // 中国边界：放大到国内范围才显示，拉远/整球视图隐藏；带 SHOW/HIDE 回滞区间
    const boundaryH = cameraHeight;
    if (!boundaryVisible && boundaryH < BOUNDARY_SHOW_HEIGHT) {
        boundaryVisible = true;
        // 第一次放大到国内范围：一次性告诉用户"省份可以点"
        maybeShowProvinceHint();
    } else if (boundaryVisible && boundaryH > BOUNDARY_HIDE_HEIGHT) {
        boundaryVisible = false;
    }
    if (chinaBoundarySource) chinaBoundarySource.show = boundaryVisible;

    // 城市名层级：与轮廓共用同一份高度读数，再深一档才出现（带回滞防闪）
    if (!cityLabelVisible && boundaryH < CITY_LABEL_SHOW_HEIGHT) {
        cityLabelVisible = true;
    } else if (cityLabelVisible && boundaryH > CITY_LABEL_HIDE_HEIGHT) {
        cityLabelVisible = false;
    }

    // 城市淡色填充：与边界共用同一份可见状态（边界数据加载失败时也照常工作）。
    // 「只在翻转时写 DataSource.show」的判定收在模块内部。
    setCityFillVisible(boundaryVisible);

    // 城市聚合切换：放大到城市范围展开为单个足迹，拉远聚合回城市标记。
    // 程序化“飞往城市”期间先不按高度切换，落地瞬间由 finishCityFlight 统一展开。
    // LOD 容差也跟着高度走（moveEnd 之外再兜一层：瞬时 setView 不会触发 moveEnd）
    deps.applyScreenSpaceError();
    syncMarkerModeByHeight(cameraHeight);
    // 导航栏「全部城市」的可用态跟着层级走（只在翻转时写 DOM）
    syncProvinceAllAvailability();
}

// 回到整球视图：飞回初始中国朝向的整球视角
function flyBackToGlobe() {
    // 卡片组开着时先收（会播 0.28s 退场动画），再起飞 —— 否则卡片是"瞬间消失 + 地球飞走"
    if (isProvinceCardsActive()) closeProvinceCards();
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
        duration: 1.8
    });
}
backGlobeBtn.addEventListener('click', flyBackToGlobe);

// 票根页（重走放映）会把镜头停在某个城市附近，
// 这个高度下自动旋转看起来像原地打转；返回地球/回到票夹时若自动旋转开着，
// 就把视角收回整个地球。只在确实被拉近（低于整球高度）时触发，避免多余飞行。
export function restoreGlobeViewForAutoRotate() {
    setTicketGlobeAutoRotate(false);
    refreshAutoRotate();
    if (!isAutoRotating()) return;
    if (deps.viewer().scene.mode !== Cesium.SceneMode.SCENE3D) return;
    if (deps.viewer().camera.positionCartographic.height >= INTRO_SHOW_HEIGHT) return;
    deps.viewer().camera.cancelFlight();
    deps.viewer().camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 21000000),
        duration: deps.reduceMotion() ? 0 : 1.8
    });
}

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
    document.body.classList.toggle('footprint-tools-open', open);
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
document.addEventListener('keydown', (e) => {
    // 灯箱打开时：← / → 切换图片
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && lightbox.classList.contains('show')) {
        switchLightbox(e.key === 'ArrowLeft' ? -1 : 1);
        return;
    }
    // 照片环的查看模式：← / → 只在查看模式里翻图（不抢地球的键盘操作）
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isPhotoRingViewing()) {
        switchPhotoRingView(e.key === 'ArrowLeft' ? -1 : 1);
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
        return;
    }
    if (isProvinceAllFlying()) {
        cancelAllCityFlight();   // 「全部城市」还在飞：Esc 先取消这次自动缩放
        return;
    }
    // 照片环逐级退：先退出查看模式，再关环，最后才轮到卡片
    if (isPhotoRingViewing()) {
        exitPhotoRingView();
        return;
    }
    if (isPhotoRingActive()) {
        hidePhotoRing(true);   // 键盘关闭时把焦点还给触发它的标记按钮
        return;
    }
    if (isProvinceCardsActive()) {
        closeProvinceCards();
    }
});


// ================= 城市聚合（整球显示城市标记，放大后展开为单个足迹） =================
// 城市标记图标：白色圆环 + 中心数量


// 状态栏文案：当前底图 + 坐标系 + 地形状态 + 足迹数 + 数据来源。
// 天地图每日额度属于运维数据，只在调试模式下显示（地址栏加 ?debug，
// 或 localStorage.footprintDebug = '1'），不把后台指标丢给读者看。
const DEBUG_STATUS = (() => {
    try {
        return new URLSearchParams(window.location.search).has('debug') ||
            localStorage.getItem('footprintDebug') === '1';
    } catch (e) { return false; }
})();

function updateStatusText() {
    const item = deps.currentBaseKey() ? deps.baseProviders()[deps.currentBaseKey()] : null;
    const coordName = item && item.gcj ? 'GCJ-02' : 'CGCS2000/WGS84';
    const usage = DEBUG_STATUS && item && item.needKey
        ? ` · 今日天地图瓦片 ${tdtTodayUsage()} 张 / 额度约 1 万`
        : '';
    deps.statusText().textContent =
        (item ? item.label + '底图' : '底图') + `（${coordName}）${terrainNote}` +
        ` · ${deps.footprints().length} 个足迹标记` + usage + ' · 地图数据 © 高德 / 天地图 · 渲染 CesiumJS';
}

// 把一条足迹从它自己的坐标系转换到当前底图坐标系：
// 高德底图基于 GCJ-02，天地图底图基于 CGCS2000（≈WGS84）。

// 底图选择持久化：localStorage 保存，刷新后继续使用上次选择的底图
/**
 * 3D 地球品牌文案：标题/描述使用「3D 地球」Tab 的独立配置（globeTitle/globeDesc）。
 * 页面不再复制全站导航或双语报头，站点名称由主题导航负责。
 */
export function applyGlobeBranding() {
    const cfg = deps.footprintCfg();
    const introTitleEl = document.querySelector('.intro-title');
    const introDescEl = document.querySelector('.intro-desc');
    if (introTitleEl && cfg.globeTitle) introTitleEl.textContent = cfg.globeTitle;
    if (introDescEl && cfg.globeDesc) introDescEl.textContent = cfg.globeDesc;
}

/** 标题卡 / 导航栏当前是否处于整球视图（其他模块判层级时用）。 */
export function isIntroVisible() {
    return introVisible;
}

/** 中国轮廓是否可见（省卡与标签判定用）。 */
export function isBoundaryVisible() {
    return boundaryVisible;
}

/** 城市名标注是否可见。 */
export function isCityLabelVisible() {
    return cityLabelVisible;
}

/** 开场动画是否进行中。 */
export function isEntranceActive() {
    return entranceActive;
}

/** 开场动画进行中：标题卡暂缓显示。 */
export function setEntranceActive(active) {
    entranceActive = !!active;
}

/** 中国轮廓数据源（加载完成后交给它，显隐交给本模块逐帧控制）。 */
export function setChinaBoundarySource(source) {
    chinaBoundarySource = source;
}

/** 三维地形可用性变化时更新状态栏里的地形文案。 */
export function setTerrainNote(note) {
    terrainNote = note;
}

/** 用最新状态重绘状态栏。 */
export function refreshStatusText() {
    updateStatusText();
}

/** 工具菜单收起（视图切换等模块在切换前主动复位）。 */
export function closeNavigationTools() {
    setNavToolsOpen(false);
}

/** 票根页覆盖导航时同步收起标题卡和工具菜单。 */
export function dismissIntroForTickets() {
    introVisible = false;
    pageIntro.classList.remove('visible');
    topNav.classList.remove('visible');
    contentDock?.classList.remove('visible');
    document.body.classList.remove('nav-zoom');
    setNavToolsOpen(false);
}

/**
 * 票根页只展示干净的地球背景：收起随低视角出现的省界与城市填充。
 * 票根浮层打开时逐帧更新会提前返回，所以必须由这里显式清一次。
 */
export function hideBoundaryForTickets() {
    boundaryVisible = false;
    if (chinaBoundarySource) chinaBoundarySource.show = false;
    setCityFillVisible(false);
}


/**
 * 启动逐帧显隐校正。必须在 setupNavigation 之后调用一次。
 */
export function initNavigation() {
    deps.viewer().scene.postRender.addEventListener(updateIntroVisibility);
    updateIntroVisibility();
}
