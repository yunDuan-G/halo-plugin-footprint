// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 判断是否为移动端

    // 判断当前路径是否为/footprints
    const currentPath = window.location.pathname;
    /*if (currentPath !== '/footprints') {
        console.log('非足迹页面，不加载地图功能');
        return;
    }*/


    // 设置全局颜色变量
    const footprintPage = document.getElementById('footprint-page');
    if (footprintPage && window.FOOTPRINT_CONFIG) {
        footprintPage.style.setProperty('--footprint-hsla', window.FOOTPRINT_CONFIG.hsla);
        // 设置标记点样式类
        if (window.FOOTPRINT_CONFIG.markerStyle) {
            document.body.classList.add('marker-style-' + window.FOOTPRINT_CONFIG.markerStyle);
        }
        if (window.FOOTPRINT_CONFIG.highlightScheme) {
            document.body.classList.add('highlight-scheme-' + window.FOOTPRINT_CONFIG.highlightScheme);
        }
    }

    // 打印插件信息
    console.log(
            '%c足迹插件%c🗺️ 记录生活轨迹，分享旅途故事\n%c作者 Handsome %cwww.lik.cc',
            'background: #42b983; color: white; padding: 2px 4px; border-radius: 3px;',
            'color: #42b983; padding: 2px 4px;',
            'color: #666; padding: 2px 4px;',
            'color: #42b983; text-decoration: underline; padding: 2px 4px;'
    );

    // 统计面板不依赖地图初始化，先渲染以避免地图加载阻塞显示
    renderStats();

    // 等待AMap对象加载完成
    const checkAMap = () => {
        if (typeof AMap === 'undefined') {
            console.warn('等待高德地图API加载...');
            setTimeout(checkAMap, 100);
            return;
        }
        console.log('高德地图API加载成功');
        initializeApp(isMobile);
    };
    checkAMap();

    // 添加事件监听（注意在组件卸载时移除）
    window.addEventListener('resize', handleResize);
});

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// ===== 统计面板 =====
function computeStats(footprints) {
    var adcodeSet = new Set();
    var citySet = new Set();
    var muniPx = ["11","12","31","50"];
    var autoPx = ["15","45","54","64","65"];
    var sarPx  = ["81","82"];
    var m = 0, a = 0, s = 0, p = 0;

    footprints.forEach(function(fp) {
        var adc = fp.spec.provinceAdcode;
        if (!adc) return;
        var px = adc.substring(0, 2);
        if (!adcodeSet.has(adc)) {
            adcodeSet.add(adc);
            if (muniPx.indexOf(px) !== -1) m++;
            else if (autoPx.indexOf(px) !== -1) a++;
            else if (sarPx.indexOf(px) !== -1) s++;
            else p++;
        }
        if (fp.spec.cityAdcode) citySet.add(fp.spec.cityAdcode);
    });

    return {
        total: footprints.length,
        provinces: adcodeSet.size,
        cities: citySet.size,
        categories: [
            { label: "直辖市", v: m, t: 4 },
            { label: "自治区", v: a, t: 5 },
            { label: "特区",   v: s, t: 2 },
            { label: "省份",   v: p, t: 23 }
        ]
    };
}

function renderStats() {
    var footprints = window.FOOTPRINT_CONFIG && window.FOOTPRINT_CONFIG.footprints;
    if (!Array.isArray(footprints)) return;

    var stats = computeStats(footprints);
    var panel = document.getElementById("map-stats");
    if (!panel) return;

    document.getElementById("stats-total").textContent = stats.total;
    document.getElementById("stats-provinces").textContent = stats.provinces + " / 34";
    document.getElementById("stats-cities").textContent = stats.cities;

    var detail = document.getElementById("stats-detail");
    detail.innerHTML = "";
    stats.categories.forEach(function(cat) {
        var row = document.createElement("div");
        row.className = "stats-cat" + (cat.v === 0 ? " is-zero" : "");
        row.innerHTML = "<span class=\"stats-cat-label\">" + cat.label + "</span>" +
                        "<span class=\"stats-cat-value\">" + cat.v + "/" + cat.t + "</span>";
        detail.appendChild(row);
    });

    panel.classList.add("show");
}

// 添加一个全局变量来跟踪当前激活的卡片
let activeCard = null;
// 跟踪当前正在执行动画的卡片（与activeCard分开，避免mouseleave中断异步动画）
let animationInFlight = null;

// 标记点DOM缓存，避免重复querySelector查询
const markerCache = new Map();

//抛物线动画加载
const loadParabolaAnimation = (card, map) => {
    // 如果当前卡片不是激活的卡片，则不执行动画
    if (card !== animationInFlight) {
        return;
    }

    // 清除之前的动画（如果有）
    if (card.currentAnimationId) {
        cancelAnimationFrame(card.currentAnimationId);
        card.currentAnimationId = null;
    }

    const canvas = document.getElementById('canvas');
    canvas.style.willChange = 'transform'; // 提示浏览器此元素会变化
    canvas.style.position = 'fixed'; // 使用fixed定位减少重排
    canvas.style.pointerEvents = 'none'; // 避免canvas拦截鼠标事件
    const ctx = canvas.getContext('2d');

    // 设置画布大小为窗口大小
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (!card) return;

    // 获取 card 的中心点
    const cardRect = card.getBoundingClientRect();
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top + cardRect.height / 2;

    //获取card子元素的class为card-header
    const cardHeader = card.querySelector('.card-header');
    //获取cardHeader的元素内容
    const cardHeaderContent = cardHeader.textContent;
    //获取class为marker-image下的img中alt为cardHeaderContent的元素
    const markerImage = markerCache.get(cardHeaderContent);


    // 获取card对应的标记点
    const footprint = window.FOOTPRINT_CONFIG.footprints.find(
            f => f.spec.name === cardHeaderContent
    );

    if (!footprint) {
        console.warn('未找到对应的足迹数据');
        return;
    }

    // 获取所有相关的标记点
    const markerImages = [];
    if (footprint.spec.metadataNames) {
        const name = footprint.metadata.name;

        const metadataName = footprint.spec.metadataNames.includes(name);
        // 如果没有当前的标记点，手动添加
        if (!metadataName) {
            markerImages.push(markerImage);
        }
        // 如果有 metadataNames，获取所有相关的标记点
        footprint.spec.metadataNames.forEach(metadataName => {
            const relatedFootprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.metadata.name === metadataName
            );
            if (relatedFootprint) {
                const marker = markerCache.get(relatedFootprint.spec.name);
                if (marker) {
                    markerImages.push(marker);
                }
            }
        });
    } else {
        // 如果没有 metadataNames，只使用当前标记点
        markerImages.push(markerImage);
    }

    // 遍历所有标记图片
    markerImages.forEach(markerImg => {
        // 查找最近的amap-marker父元素
        const markerElement = markerImg?.closest('.amap-marker');
        if (markerElement) {
            // 将card对应的标记点显示到最上层
            markerElement.classList.add('zIndex13');
            // 主标记点（非关联标记点）额外突出显示
            if (markerImg === markerImage) {
                markerElement.classList.add('zIndex14');
                markerElement.classList.add('marker-highlight');
            }
        }
    });

    // 获取所有相关的标记点
    const mapCenter = [];
    if (footprint.spec.metadataNames
            && footprint.spec.metadataNames.length > 0 &&
            !(footprint.spec.metadataNames.length === 1 && footprint.spec.metadataNames.includes(footprint.metadata.name))) {
        const name = footprint.metadata.name;

        const metadataName = footprint.spec.metadataNames.includes(name);
        // 如果没有当前的标记点，手动添加
        if (!metadataName) {
            const pixel = map.lngLatToContainer([footprint.spec.longitude, footprint.spec.latitude]); // 相对于地图容器的坐标
            // 转换为屏幕XY坐标
            const mapCenterXY = {
                mapCenterX: pixel.x,
                mapCenterY: pixel.y
            }
            mapCenter.push(mapCenterXY)
        }
        // 如果有 metadataNames，获取所有相关的标记点
        footprint.spec.metadataNames.forEach(metadataName => {
            const relatedFootprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.metadata.name === metadataName
            );
            if (relatedFootprint) {
                const pixel = map.lngLatToContainer([relatedFootprint.spec.longitude, relatedFootprint.spec.latitude]); // 相对于地图容器的坐标
                // 转换为屏幕XY坐标
                const mapCenterXY = {
                    mapCenterX: pixel.x,
                    mapCenterY: pixel.y
                }
                // 如果没有 metadataNames，只使用当前标记点
                mapCenter.push(mapCenterXY)
            }
        });
    } else {
        const pixel = map.lngLatToContainer([footprint.spec.longitude, footprint.spec.latitude]); // 相对于地图容器的坐标
        // 转换为屏幕XY坐标
        const mapCenterXY = {
            mapCenterX: pixel.x,
            mapCenterY: pixel.y
        }
        // 如果没有 metadataNames，只使用当前标记点
        mapCenter.push(mapCenterXY)
    }

    // 为每个标记点创建动画
    const animations = mapCenter.map(center => {
        // 起点和终点
        const startPoint = {x: cardCenterX, y: cardCenterY};
        const endPoint = {x: center.mapCenterX, y: center.mapCenterY - 36};

        // 控制点，控制抛物线形状
        const controlPoint = {
            x: (startPoint.x + endPoint.x) / 2,
            y: Math.min(startPoint.y, endPoint.y) - 150
        };

        return {
            startPoint,
            endPoint,
            controlPoint,
            progress: 0,
            startTime: null
        };
    });

    // 动画参数
    const duration = 500; // 动画持续时间(ms)
    let isAnimating = true;

    // 绘制抛物线上的箭头
    function drawArrow(x, y, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        // 箭头形状
        const arrowSize = 20; // 箭头大小
        const arrowWidth = 10; // 箭头宽度

        // 绘制实心三角形箭头
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowSize, -arrowWidth);
        ctx.lineTo(-arrowSize, arrowWidth);
        ctx.closePath();
        ctx.fillStyle = '#000000';
        ctx.fill();

        ctx.restore();
    }

    // 计算二次贝塞尔曲线上的点
    function getQuadraticBezierPoint(t, p0, p1, p2) {
        const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        return {x, y};
    }

    // 计算二次贝塞尔曲线的切线角度
    function getQuadraticBezierAngle(t, p0, p1, p2) {
        const dx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
        const dy = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
        return Math.atan2(dy, dx);
    }

    // 绘制虚线抛物线
    function drawDashedCurve(startPoint, controlPoint, endPoint) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, endPoint.x, endPoint.y);

        ctx.setLineDash([6, 4]); // 虚线模式: 5px实线，3px空白
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        // ctx.stroke();
        // ctx.setLineDash([]); // 重置为实线
    }

    // 动画循环
    function animate(timestamp) {
        if (!isAnimating || card !== activeCard) {
            if (card.currentAnimationId) {
                cancelAnimationFrame(card.currentAnimationId);
                card.currentAnimationId = null;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // 清除画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 更新每个动画的进度
        animations.forEach(animation => {
            if (!animation.startTime) animation.startTime = timestamp;
            const elapsed = timestamp - animation.startTime;
            animation.progress = Math.min(elapsed / duration, 1);

            // 绘制完整的虚线抛物线
            drawDashedCurve(animation.startPoint, animation.controlPoint, animation.endPoint);

            // 计算当前动画点在曲线上的位置
            const currentPoint = getQuadraticBezierPoint(
                    animation.progress,
                    animation.startPoint,
                    animation.controlPoint,
                    animation.endPoint
            );

            // 计算当前点的切线角度
            const angle = getQuadraticBezierAngle(
                    animation.progress,
                    animation.startPoint,
                    animation.controlPoint,
                    animation.endPoint
            );

            // 绘制当前位置的箭头
            drawArrow(currentPoint.x, currentPoint.y, angle);

            // 绘制从起点到当前点的实线部分
            ctx.beginPath();
            ctx.moveTo(animation.startPoint.x, animation.startPoint.y);

            // 为了绘制实线部分，我们需要细分曲线
            const segments = 50;
            for (let i = 0; i <= segments * animation.progress; i++) {
                const t = i / segments;
                const p = getQuadraticBezierPoint(t, animation.startPoint, animation.controlPoint, animation.endPoint);
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // 检查是否所有动画都完成
        const allComplete = animations.every(animation => animation.progress >= 1);

        // 继续动画直到完成
        if (!allComplete) {
            card.currentAnimationId = requestAnimationFrame(animate);
        } else {
            card.currentAnimationId = null; // 动画完成后清除 ID
            isAnimating = false; // 标记动画结束
        }
    }

    // 开始动画
    isAnimating = true;
    card.currentAnimationId = requestAnimationFrame(animate);

    // 响应窗口大小变化
    const resizeHandler = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeHandler);

    // 添加清理函数
    const cleanup = () => {
        const timeLineBox = document.getElementById('timeLineBox');
        if (timeLineBox) {
            timeLineBox.removeEventListener('scroll', handleScroll);
        }
        isAnimating = false;
        if (card.currentAnimationId) {
            cancelAnimationFrame(card.currentAnimationId);
            card.currentAnimationId = null;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.removeEventListener('resize', resizeHandler);
        card.removeEventListener('mouseleave', handleLeave);
        // 清除引用
        // 移除标记点的置顶和高亮
        document.querySelectorAll('.amap-marker').forEach(marker => {
            marker.classList.remove('zIndex13');
            marker.classList.remove('zIndex14');
            marker.classList.remove('marker-highlight');
        });
        card = null;
    };

    const handleLeave = debounce(cleanup, 100);
    card.addEventListener('mouseleave', handleLeave);
};

//是否打开时间线
let isTimelineOpen = false;

//是否打开仰角和旋转
let isElevation = false;

// 添加图片预加载和缓存
const imageCache = new Map();

//保存上一次悬停卡片的坐标
let lastPositions = [];

//渲染抽屉中的时间线
const populateTimeline = async (map) => {
    const timelineContainer = document.getElementById('timelineDrawer');
    const footprints = window.FOOTPRINT_CONFIG.footprints;

    if (!Array.isArray(footprints) || footprints.length === 0) {
        timelineContainer.innerHTML = '<p>No footprints available.</p>';
        return;
    }

    // 添加时间线按钮事件处理
    const timelineBtn = document.getElementById('timeline-btn');
    const timelineDrawer = document.getElementById('timelineDrawer');
    const closeDrawerBtn = document.getElementById('closeBtn');
    const timeline = document.getElementById('timeline');
    const timelineContent = document.getElementById('timelineContent');

    footprints.forEach((item, index) => {
        const image = item.spec.image.replace("!w100", "!A100");
        const cachedImage = image + "/fw/500" ? getCachedImage(escapeHtml(image)) : 'https://www.lik.cc/upload/loading8.gif';

        const timelineItem = document.createElement('div');
        timelineItem.className = 'timeline-item';

        // 创建日期元素
        const timelineDate = document.createElement('div');
        timelineDate.className = 'timeline-date';
        timelineDate.textContent = formatDateToYMD(item.spec.createTime);
        timelineItem.appendChild(timelineDate);

        // 创建内容卡片
        const contentCard = document.createElement('div');
        contentCard.className = 'timeline-content-card';
        timelineItem.appendChild(contentCard);

        // 创建媒体容器
        const timelineMedia = document.createElement('div');
        timelineMedia.className = 'timeline-media';
        contentCard.appendChild(timelineMedia);

        // 创建图片
        const img = document.createElement('img');
        img.src = cachedImage;
        img.loading = 'lazy';
        img.alt = item.spec.name;
        timelineMedia.appendChild(img);

        // 创建媒体覆盖层
        const mediaOverlay = document.createElement('div');
        mediaOverlay.className = 'media-overlay';
        timelineMedia.appendChild(mediaOverlay);

        // 创建位置信息
        const locationDiv = document.createElement('div');
        locationDiv.className = 'timeline-location';

        // 创建标题
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.textContent = item.spec.name;

        // 添加SVG_ICONS.location图标到名称左侧
        const iconSpan = document.createElement('span');
        iconSpan.innerHTML = SVG_ICONS.location;
        iconSpan.classList.add('location-icon'); // 添加 class
        locationDiv.appendChild(iconSpan);
        locationDiv.appendChild(cardHeader);

        mediaOverlay.appendChild(locationDiv);

        // 创建信息覆盖层
        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'timeline-info-overlay';
        mediaOverlay.appendChild(infoOverlay);

        // 创建描述
        const desc = document.createElement('p');
        desc.className = 'timeline-desc';
        desc.textContent = item.spec.description;
        infoOverlay.appendChild(desc);

        // 创建按钮
        const detailBtn = document.createElement('button');
        detailBtn.className = 'detail-btn';
        detailBtn.id = 'detailBtn';

        // 创建按钮图标
        const binocularsIcon = document.createElement('i');
        binocularsIcon.className = 'fas fa-binoculars';
        detailBtn.appendChild(binocularsIcon);

        // 添加按钮文本
        detailBtn.appendChild(document.createTextNode(' 查看旅行故事'));
        infoOverlay.appendChild(detailBtn);

        // 最后将整个元素添加到时间线中
        timeline.appendChild(timelineItem);

        // 添加点击事件处理
        detailBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            // 清除抛物线动画
            if (timelineItem.currentAnimationId) {
                cancelAnimationFrame(timelineItem.currentAnimationId);
                timelineItem.currentAnimationId = null;
            }

            // 清除画布
            const canvas = document.getElementById('canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            // 重置动画状态
            isAnimating = false;
            activeCard = null;

            const cardHeader = timelineItem.querySelector('.card-header');
            const cardHeaderContent = cardHeader.textContent;
            const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.spec.name === cardHeaderContent
            );
            if (isMobile) {
                isTimelineOpen = false;
                timelineDrawer.classList.remove('open');
                const mapControls = document.getElementById('map-controls');
                mapControls.classList.remove('open');

                // 卸载所有图片
                const cards = document.querySelectorAll('.timeline-card');
                cards.forEach(card => {
                    card.style.backgroundImage = 'none';
                    card.classList.add('loading');
                });
            }
            if (footprint) {
                // 查找并触发对应的标记点点击事件
                const marker = map.getAllOverlays().find(
                        m => m._position.lng === parseFloat(footprint.spec.longitude) &&
                                m._position.lat === parseFloat(footprint.spec.latitude)
                );

                if (marker) {
                    marker.emit('click');
                }
            }
        });

        // 添加动画延迟
        setTimeout(() => {
            timelineItem.classList.add('visible');
        }, 300 + (index * 200));
    });

    // 打开抽屉
    timelineBtn.addEventListener('click', () => {
        const zoomButtons = document.getElementById('zoom-buttons');
        const line = document.getElementById('line');
        //隐藏时间线按钮/缩放按钮/线路按钮
        timelineBtn.classList.add('hidden-important');
        zoomButtons.classList.add('hidden-important');
        line.classList.add('hidden-important');

        const footprintMap = document.getElementById('footprint-map');
        const timelineDrawer = document.getElementById('timelineDrawer');
        const drawerRect = timelineDrawer.getBoundingClientRect();
        const number = window.innerWidth - drawerRect.width;
        footprintMap.style.width = number + "px";
        //还原仰角和旋转
        if (isElevation) {
            map.setPitch(0);
            map.setRotation(0);
        }
        isTimelineOpen = true;
        timelineDrawer.classList.add('open');
        const mapControls = document.getElementById('map-controls');
        mapControls.classList.add('open');

        // 添加滚动事件监听
        timelineContent.addEventListener('scroll', handleScroll);
    });

    // 合上抽屉
    closeDrawerBtn.addEventListener('click', () => {
        //显示时间线按钮/缩放按钮/线路按钮
        const zoomButtons = document.getElementById('zoom-buttons');
        const line = document.getElementById('line');
        timelineBtn.classList.remove('hidden-important');
        zoomButtons.classList.remove('hidden-important');
        line.classList.remove('hidden-important');

        //还原地图宽度
        const footprintMap = document.getElementById('footprint-map');
        footprintMap.style.width = window.innerWidth + "px";

        isTimelineOpen = false;
        timelineDrawer.classList.remove('open');
        const mapControls = document.getElementById('map-controls');
        mapControls.classList.remove('open');

        // 移除滚动事件监听
        timelineContent.removeEventListener('scroll', handleScroll);
    });



    // 为每个卡片绑定鼠标悬停事件
    const timelineCards = document.querySelectorAll('.timeline-content-card');
    timelineCards.forEach(card => {
        if (isMobile) return; //手机端不添加悬停事件
        let debounceTimer;
        let isProcessing = false;

        const handleEnter = async () => {
            if (isProcessing) return;
            //还原仰角和旋转
            if (isElevation) {
                map.setPitch(0);
                map.setRotation(0);
            }
            isElevation = false;
            try {
                isProcessing = true;
                activeCard = card;
                animationInFlight = card;

                // 关闭已打开的信息窗口
                const allOverlays = map.getAllOverlays();
                allOverlays.forEach(overlay => {
                    if (overlay instanceof AMap.InfoWindow) {
                        overlay.close();
                    }
                });


                const zoom = 6.5;

                const cardHeader = card.querySelector('.card-header');
                const cardHeaderContent = cardHeader.textContent;
                const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                        f => f.spec.name === cardHeaderContent
                );
                const position2 = new AMap.LngLat(
                        parseFloat(footprint.spec.longitude),
                        parseFloat(footprint.spec.latitude)
                );

                const currentPos = map.getCenter();
                const distance = position2.distance(currentPos);
                const currentZoom = map.getZoom();
                const needsMovement = distance > 1000 || currentZoom < 13;

                //获取关联标记点
                const metadataNames = footprint.spec.metadataNames;
                //判断是否有 关联标记点
                if (metadataNames && metadataNames.length > 0 &&
                        // 判断关联标记点是否为自身
                        !(metadataNames.length === 1 && metadataNames.includes(footprint.metadata.name))) {
                    const name = footprint.metadata.name;
                    const metadataName = footprint.spec.metadataNames.includes(name);
                    // 统计关联的标记点到集合
                    const positions = metadataNames
                            .map(metadataName => window.FOOTPRINT_CONFIG.footprints.find(
                                    f => f.metadata.name === metadataName
                            ))
                            .filter(Boolean);
                    // 把自身加入到 标记点集合中
                    if (!metadataName) {
                        positions.push(footprint);
                    }

                    const allOverlays = map.getAllOverlays();
                    const newOverlays = positions
                            .map(value => allOverlays.find(
                                    f => f._position.lng === value.spec.longitude && f._position.lat === value.spec.latitude
                            ))
                            .filter(Boolean);
                    lastPositions = newOverlays;

                    //获取多个标记点的 地图中心点 和 缩放级别
                    const byOverlays = map.getFitZoomAndCenterByOverlays(newOverlays, [350, 120, 120, 120]);
                    // 提取坐标
                    const newPosition = new AMap.LngLat(byOverlays[1].lng, byOverlays[1].lat);

                    //判断是否需要移动地图
                    if (!window.FOOTPRINT_CONFIG.enableHoverZoom) {
                        // 关闭悬停缩放：直接渲染抛物线
                        zoomOff(map);
                        loadParabolaAnimation(card, map);
                    } else if (!byOverlays[0].toString().startsWith(currentZoom)) {
                        //第一次 绑定地图 缩放事件
                        zoomOn(map, card, newPosition, zoom, 1);
                        const sameZoom = await moveToLocation(map, newPosition, zoom, 0);
                        if (sameZoom) {
                            // 同级缩放不会触发 zoomend，因此直接结束监听并启动抛物线
                            zoomOff(map);
                            zoomOff3(map);
                            loadParabolaAnimation(card, map);
                        }
                    } else {
                        loadParabolaAnimation(card, map);
                        zoomOff(map);
                    }
                } else {
                    if (!window.FOOTPRINT_CONFIG.enableHoverZoom) {
                        // 关闭悬停缩放：直接渲染抛物线
                        zoomOff(map);
                        loadParabolaAnimation(card, map);
                    } else if (needsMovement) {
                        //第一次 绑定地图 缩放事件
                        zoomOn(map, card, position2, zoom, 1);
                        // 绑定次数
                        frequency = 1;

                        // 获取悬停card的 Overlays
                        const newOverlays2 = allOverlays.filter(
                                f => f && f._position && f._position.lng === position2.getLng() && f._position.lat === position2.getLat()
                        );

                        // 获取上次悬停card的 Overlays
                        /*const newOverlays3 = lastPositions
                                .map(value => allOverlays.find(
                                        f => f._position.lng === value.getLng() && f._position.lat === value.getLat()
                                ))
                                .filter(Boolean);*/
                        /*const mergedOverlays = [...new Set([...newOverlays2, ...lastPositions])];

                        lastPositions = newOverlays2;*/

                        //获取多个标记点的 地图中心点 和 缩放级别
                        const mergedOverlay = map.getFitZoomAndCenterByOverlays(newOverlays2, [350, 120, 120, 120]);
                        // 提取坐标
                        const newPosition2 = new AMap.LngLat(mergedOverlay[1].lng, mergedOverlay[1].lat);

                        //缩放到 多个标记点的 地图中心点 和 缩放级别
                        const sameZoom = await moveToLocation(map, newPosition2, zoom, 5);
                        if (sameZoom) {
                            // 同级缩放不会触发 zoomend，因此直接结束监听并启动抛物线
                            zoomOff(map);
                            zoomOff3(map);
                            loadParabolaAnimation(card, map);
                        }
                        // await moveToLocation(map, position2, zoom, 0);
                    } else {
                        loadParabolaAnimation(card, map);
                        zoomOff(map);
                    }
                }
            } catch (error) {
                console.error('处理卡片悬停时发生错误:', error);
                isAnimating = false;
                if (card.currentAnimationId) {
                    cancelAnimationFrame(card.currentAnimationId);
                    card.currentAnimationId = null;
                }
            } finally {
                isProcessing = false;
            }
        };

        const handleLeave = () => {
            // 立即取消任何待执行的 handleEnter，避免竞态条件
            animationInFlight = null;
            const amapMarker = document.querySelectorAll('.amap-marker');
            amapMarker.forEach(marker => {
                marker.classList.remove('zIndex13');
                marker.classList.remove('zIndex14');
                marker.classList.remove('marker-highlight');
            });
            return new Promise((resolve) => {
                debounceTimer = setTimeout(() => {
                    if (activeCard === card) {
                        activeCard = null;
                    }
                    zoomOff(map);
                    zoomOff3(map);
                    if (card.currentAnimationId) {
                        cancelAnimationFrame(card.currentAnimationId);
                        card.currentAnimationId = null;
                        const canvas = document.getElementById('canvas');
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    resolve();
                }, 100);
            });
        };

        card.addEventListener('mouseenter', async () => {
            card._hoverCancelled = false;
            await handleLeave();
            // 快速切换时，handleLeave 已标记取消，跳过 handleEnter
            if (card._hoverCancelled) return;
            handleEnter();
        });
        card.addEventListener('mouseleave', () => {
            card._hoverCancelled = true;
            handleLeave();
        });
    });
};

// 存储绑定的函数，方便解绑
let boundZoomStart, boundZoom, boundZoomEnd;

//缩放事件绑定次数
let frequency;


//绑定事件 用于card的悬停
function zoomOn(map, card, newPosition, zoom) {
    // console.log("绑定事件!");

    // 存储绑定的函数
    boundZoomStart = mapZoomstart.bind(null, card);
    boundZoom = mapZoom.bind(null, card);
    boundZoomEnd = mapZoomend.bind(null, card, map, newPosition, zoom);

    map.on('zoomstart', boundZoomStart);
    map.on('zoomchange', boundZoom);
    map.on('zoomend', boundZoomEnd);
}

function zoomOff(map, card, newPosition, byOverlays) {
    // console.log("解除事件绑定!");

    // 使用存储的函数引用解绑
    map.off('zoomstart', boundZoomStart);
    map.off('zoomchange', boundZoom);
    map.off('zoomend', boundZoomEnd);
    if (card) {
        //第二次 绑定地图 缩放事件
        zoomOn3(map, card, newPosition, byOverlays, 2);
        moveToLocation(map, newPosition, byOverlays, 0).then((sameZoom) => {
            // 第二次移动若已处于目标级别，不会触发 zoomend，需主动结束监听并渲染抛物线
            if (sameZoom) {
                zoomOff3(map, card);
            }
        });
    }
}

// 存储绑定的函数，方便解绑
let boundZoomStart2, boundZoom2, boundZoomEnd2;

//绑定事件 用于标记点的缩放
function zoomOn2(map, card) {
    // console.log("绑定事件2!");

    // 存储绑定的函数
    boundZoomStart2 = mapZoomstart.bind(null, card);
    boundZoom2 = mapZoom.bind(null, card);
    boundZoomEnd2 = mapZoomend.bind(null, card, map, null, null, null);

    map.on('zoomstart', boundZoomStart2);
    map.on('zoomchange', boundZoom2);
    map.on('zoomend', boundZoomEnd2);
}

function zoomOff2(map) {
    // console.log("解除事件绑定2!");

    // 使用存储的函数引用解绑
    map.off('zoomstart', boundZoomStart2);
    map.off('zoomchange', boundZoom2);
    map.off('zoomend', boundZoomEnd2);
}

// 存储绑定的函数，方便解绑
let boundZoomStart3, boundZoom3, boundZoomEnd3;

//绑定事件 用于标记点的缩放
function zoomOn3(map, card, newPosition, zoom) {
    // console.log("绑定事件3!");

    // 存储绑定的函数
    boundZoomStart3 = mapZoomstart.bind(null, card);
    boundZoom3 = mapZoom.bind(null, card);
    boundZoomEnd3 = mapZoomend.bind(null, card, map, newPosition, zoom);

    map.on('zoomstart', boundZoomStart3);
    map.on('zoomchange', boundZoom3);
    map.on('zoomend', boundZoomEnd3);
}

function zoomOff3(map, card) {
    // console.log("解除事件绑定3!");
    // 第二次 缩放结束以后执行抛物线
    if (card) {
        loadParabolaAnimation(card, map);
    }

    // 使用存储的函数引用解绑
    map.off('zoomstart', boundZoomStart3);
    map.off('zoomchange', boundZoom3);
    map.off('zoomend', boundZoomEnd3);
}

//地图开始缩放
function mapZoomstart() {
    // console.log("缩放开始");
}

//地图缩放中
function mapZoom(map) {
    // console.log("正在缩放");
}

//缩放结束
async function mapZoomend(card, map, newPosition, byOverlays) {
    // console.log("缩放结束");
    //卡片不为空时执行抛物线
    if (card != null) {
        if (frequency === 2) {
            // console.log("第二次解除绑定");
            zoomOff3(map, card);
            frequency = 1;
            return;
        }
        frequency = 2
        // 第一次 解除绑定 缩放事件
        zoomOff(map, card, newPosition, byOverlays);


    } else {
        zoomOff2(map);
        /*if (isMobile) {
            map.panBy(0, 120);
        }*/
        // calculateTheNewCenterPoint(map);
    }
}

// 计算打开抽屉后，中间点的偏移像素
const calculateTheNewCenterPoint = (map) => {
    if (!isTimelineOpen) {
        return;
    }

    const drawer = document.getElementById("timelineDrawer");
    const drawerWidth = drawer.getBoundingClientRect().width;

    // 1. 计算抽屉左边到窗口左边的距离
    const availableWidth = window.innerWidth - drawerWidth;

    // 2. 计算新的中心点（相对于窗口左侧）
    const newCenterX = availableWidth / 2;

    // 3. 计算原始中心点到新中心点的距离
    const number = (window.innerWidth / 2) - newCenterX;

    // 移动
    map.panBy(-number + 60, (window.innerHeight / 4) - 80);
}

// 优化动画性能
const showElements = () => {
    // 添加初始类
    document.body.classList.add('theme-ready');

    // 动画序列
    const animationSequence = [
        {
            element: '.logo-container',
            className: 'show',
            delay: 0,
            callback: () => {
                requestAnimationFrame(() => {
                    document.querySelector('.footprint-logo').style.color = 'var(--primary-color)';
                });
            }
        },
        {
            element: '.map-controls',
            className: 'show',
            delay: 200,
            callback: () => {
                // 依次显示控制按钮
                const buttons = document.querySelectorAll('.map-controls .control-btn');
                buttons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        // 添加缩放效果
                        btn.classList.add('scale-in');
                        // 移除缩放效果
                        setTimeout(() => btn.classList.remove('scale-in'), 300);
                    }, index * 100);
                });
            }
        },
        {
            element: '.zoom-controls',
            className: 'show',
            delay: 400,
            callback: () => {
                const zoomButtons = document.querySelectorAll('.zoom-controls button');
                zoomButtons.forEach((btn, index) => {
                    setTimeout(() => {
                        btn.classList.add('show');
                        btn.classList.add('slide-in');
                        setTimeout(() => btn.classList.remove('slide-in'), 300);
                    }, index * 100);
                });
            }
        }
    ];

    // 执行动画序列
    animationSequence.forEach(({element, className, delay, callback}) => {
        setTimeout(() => {
            const el = document.querySelector(element);
            if (el) {
                el.classList.add(className);
                if (callback) {
                    callback();
                }
            }
        }, delay);
    });

// 为底部工具栏添加进入动画
    const mapControls = document.querySelector('.map-controls');
    if (mapControls) {
        setTimeout(() => {
            const buttons = mapControls.querySelectorAll('button, .control-btn, #timeline-btn, #messageBoards');
            buttons.forEach((btn, index) => {
                setTimeout(() => {
                    btn.classList.add('animate-in');
                    // 添加波纹效果和提示
                    addRippleEffect(btn);

                    // 添加点击脉冲效果
                    btn.addEventListener('click', () => {
                        btn.classList.add('btn-pulse');
                        setTimeout(() => {
                            btn.classList.remove('btn-pulse');
                        }, 300);
                    });
                }, 600 + (index * 120)); // 增加延迟和间隔，使动画更平滑
            });
        }, 800);
    }
};

// 图层配置
const layerConfig = {
    satellite: {
        zIndex: 0,
        opacity: 1
    },
    road: {
        zIndex: 1,
        opacity: 0.6,
        strokeColor: '#666666'
    },
    traffic: {
        zIndex: 2,
        opacity: 0.6
    }
};


// 优化地图移动
const moveToLocation = (map, position, Zoom, time) => {
    return new Promise((resolve) => {
        // 启用动画
        map.setStatus({animateEnable: true});

        const sameZoom = Number(map.getZoom()) === Number(Zoom);
        // 旧逻辑会先放大两级再缩回，造成额外的地图跳转。
        // 这里统一使用一次 setZoomAndCenter 完成缩放和平移。
        const requestedDuration = Number(time);
        const duration = Number.isFinite(requestedDuration) && requestedDuration >= 100
                ? requestedDuration
                : 500;
        const currentCenter = map.getCenter();
        const centerChanged = currentCenter && typeof currentCenter.distance === 'function'
                ? currentCenter.distance(position) > 1
                : true;
        const endEvent = centerChanged ? 'moveend' : (sameZoom ? null : 'zoomend');
        let timeoutId;
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            if (endEvent) {
                map.off(endEvent, finish);
            }
            clearTimeout(timeoutId);
            resolve(sameZoom);
        };

        if (endEvent) {
            map.on(endEvent, finish);
        }
        timeoutId = setTimeout(finish, duration + 300);

        // 单次完成缩放与平移，不再人为放大两级来触发 zoomend。
        map.setZoomAndCenter(Zoom, position, false, duration);

        // 目标中心和缩放级别都未变化时，高德不会触发结束事件。
        if (!endEvent) {
            requestAnimationFrame(finish);
        }
    });
};


const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';

    const image = spec.image.replace("!w100", "!A100");

    // 使用图片压缩服务
    const compressedImageUrl = spec.image ? image + "/fw/200" : 'https://www.lik.cc/upload/loading8.gif';

    markerContent.innerHTML = `
        <div class="marker-label">${spec.name || ''}</div>
        <div class="marker-image">
            <img src="${compressedImageUrl}"
                 alt="${spec.name || '足迹标记'}"
                 decoding="async">
        </div>
        <div class="marker-badge">${spec.footprintType ? spec.footprintType.charAt(0) : ''}</div>
        <div class="marker-arrow"></div>
    `;

    return markerContent;
};

// 格式化时间
const formatTime = (timeString) => {
    if (!timeString) return '';
    try {
        const date = new Date(timeString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/\//g, '-');
    } catch (e) {
        console.warn('时间格式化失败:', e);
        return timeString;
    }
};

// 格式化为 yyyy-mm-dd
function formatDateToYMD(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    } catch {
        return dateString;
    }
}

// 常量定义
const SVG_ICONS = {
    type: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
        <path d="M9 12h6"></path>
    </svg>`,
    date: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>`,
    location: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
        <circle cx="12" cy="10" r="3"></circle>
    </svg>`
};

function escapeHtml(unsafe = '') {
    return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

function createInfoWindow(spec) {
    // 默认值处理和转义
    const {
        image = '',
        name = '',
        footprintType = '未知类型',
        createTime = '',
        address = '未知位置',
        description = '',
        article = ''
    } = spec;

    // 格式化时间
    const formatDate = (dateString) => {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).replace(/\//g, '-');
        } catch {
            return '';
        }
    };

    // 构建公共HTML部分
    const buildCommonHtml = () => `
        <h3 class="title">${escapeHtml(name)}</h3>
        <div class="meta">
            <span>${SVG_ICONS.type} ${escapeHtml(footprintType)}</span>
        </div>
        <div class="meta">
            <span>${SVG_ICONS.date} ${formatDate(createTime)}</span>
        </div>
        <div class="meta">
            <span>${SVG_ICONS.location} ${escapeHtml(address)}</span>
        </div>
        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
        ${article ? `
            <a href="${escapeHtml(article)}" target="_blank" class="article-btn">
                查看文章
                <div class="arrow-wrapper">
                    <div class="arrow"></div>
                </div>
            </a>
        ` : ''}
    `;

    // 构建图片HTML
    // 优化图片内容生成逻辑
    const imageContent = (() => {
        const cachedImage = image ? getCachedImage(escapeHtml(image)) : getCachedImage('https://www.lik.cc/upload/loading8.gif');
        return `<img src="${cachedImage}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">`;
    })();

    return `
        <div class="info-window">
            <div class="image">
            ${imageContent}
                <div class="image-info">
                    ${buildCommonHtml()}
                </div>
            </div>
        </div>
    `;
}

const getCachedImage = (src) => {
    if (!imageCache.has(src)) {
        const img = new Image();
        img.src = src;
        imageCache.set(src, img);
    }
    return imageCache.get(src).src;
};

// 优化防抖函数，添加立即执行选项
// 优化后的防抖函数（支持立即执行）
const debounce = (func, wait = 100, immediate = false) => {
    let timeout;
    return function (...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
};


// 使用防抖优化resize事件
const handleResize = debounce(() => {
    const mapContainer = document.getElementById('footprint-map');
    const timelineDrawer = document.getElementById('timelineDrawer');

    if (!mapContainer || !timelineDrawer) return;

    if (isTimelineOpen) {
        // 抽屉打开时的计算逻辑
        const drawerRect = timelineDrawer.getBoundingClientRect();
        const newMapWidth = window.innerWidth - drawerRect.width;

        // 应用新宽度（添加CSS过渡效果）
        mapContainer.style.transition = 'width 0.3s ease';
        mapContainer.style.width = `${newMapWidth}px`;

    } else {
        // 全屏模式
        mapContainer.style.transition = 'width 0.3s ease';
        mapContainer.style.width = '100%';
    }
}, 150);

// 滚动处理函数
const handleScroll = debounce(() => {
    // 清除抛物线动画
    if (activeCard != null && activeCard.currentAnimationId) {
        cancelAnimationFrame(activeCard.currentAnimationId);
        activeCard.currentAnimationId = null;
    // 清理标记点置顶和高亮
    document.querySelectorAll('.amap-marker').forEach(marker => {
        marker.classList.remove('zIndex13');
        marker.classList.remove('zIndex14');
        marker.classList.remove('marker-highlight');
    });
    }

    // 清除画布
    const canvas = document.getElementById('canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // 重置动画状态
    isAnimating = false;
    activeCard = null;
    // 清除抛物线动画

}, 10);

// 添加足迹标记
const addFootprintMarkers = async (map, footprintData) => {
    // 创建信息窗体
    let infoWindow = new AMap.InfoWindow({
        isCustom: true,
        autoMove: false,
        offset: new AMap.Pixel(0, -40)
    });

    // 用于存储当前打开的标记
    let currentMarker = null;
    let isMapMoving = false;

    // 用于跟踪当前触摸状态
    let isDragging = false;
    let touchStartPos = null;

    map.on('touchstart', (e) => {
        if (currentMarker) {
            // 如果信息窗口已打开，允许地图拖动
            map.setDefaultCursor('grab');
        }
    });

    map.on('touchmove', (e) => {
        if (currentMarker) {
            // 拖动地图时关闭信息窗口
            // infoWindow.close();
            // currentMarker = null;
        }
    });

    map.on('touchend', (e) => {
        map.setDefaultCursor('');
    });

    // 创建事件处理防抖函数
    const debouncedUpdate = debounce(() => {
        isMapMoving = false;
    }, 150);

    // 创建事件委托处理函数
    const handleMapClick = (e) => {
        if (currentMarker) {
            infoWindow.close();
            currentMarker = null;
            //还原仰角和旋转
            if (isElevation) {
                map.setPitch(0);
                map.setRotation(0);
            }
        }
    };

    // 创建信息窗口事件处理函数
    const handleInfoWindowClick = (e) => {
        e.stopPropagation();
    };

    const handleArticleClick = (e) => {
        e.stopPropagation();
    };

    // 一次性添加信息窗口事件监听器
    const setupInfoWindowEvents = () => {
        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.addEventListener('click', handleInfoWindowClick);

            const articleBtn = infoWindowElement.querySelector('.article-btn');
            if (articleBtn) {
                articleBtn.addEventListener('click', handleArticleClick);
            }
        }
    };

    // 监听地图移动状态
    map.on('movestart', () => {
        isMapMoving = true;
    });

    map.on('moveend', debouncedUpdate);

    // 添加全局点击事件监听器
    map.on('click', handleMapClick);

    // 打开信息窗口的函数
    const openInfoWindow = (position, content) => {
        infoWindow.setContent(content);
        infoWindow.open(map, position);

        // 使用 requestAnimationFrame 确保 DOM 已更新
        requestAnimationFrame(setupInfoWindowEvents);
    };

    // 分批次渲染
    const batchSize = 1;
    let currentIndex = 0;

    // 先按创建时间降序排序
    const sortedFootprintData = [...footprintData].sort((a, b) => {
        const timeA = new Date(a.spec.createTime).getTime();
        const timeB = new Date(b.spec.createTime).getTime();
        return timeA - timeB;
    });

    const renderBatch = () => {
        const batch = sortedFootprintData.slice(currentIndex, currentIndex + batchSize);
        batch.forEach(footprint => {
            if (!Array.isArray(sortedFootprintData) || sortedFootprintData.length === 0) {
                console.warn('足迹数据为空或格式不正确');
                return;
            }

            const longitude = parseFloat(footprint.spec.longitude);
            const latitude = parseFloat(footprint.spec.latitude);

            if (isNaN(longitude) || isNaN(latitude)) {
                console.warn('无效的经纬度数据:', footprint);
                return;
            }

            try {
                const position = new AMap.LngLat(longitude, latitude);
                const markerContent = createMarker(footprint.spec);
                const marker = new AMap.Marker({
                    position: position,
                    content: markerContent,
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, -15),
                    extData: footprint.spec // 存储额外数据
                });

                // 处理点击事件
                const handleMarkerClick = async (marker) => {
                    // 如果当前标记已经打开，则关闭它
                    if (currentMarker === marker) {
                        infoWindow.close();
                        currentMarker = null;
                        return;
                    }

                    // 先关闭当前窗体
                    if (currentMarker) {
                        infoWindow.close();
                    }

                    // 构建信息窗体内容
                    const content = createInfoWindow(footprint.spec);

                    const zoomLevel = Number(footprint.spec.zoomLevel);
                    //时间线抽屉打开时设置中心点偏右
                    //
                    const position2 = new AMap.LngLat(longitude, latitude);
                    // 检查是否需要移动地图
                    const currentPos = map.getCenter();
                    const distance = position2.distance(currentPos);
                    const currentZoom = map.getZoom();

                    // 如果距离超过3公里或缩放级别不够，需要移动地图
                    const needsMovement = distance > 3000 || currentZoom !== zoomLevel;

                    if (needsMovement) {
                        zoomOff2(map);
                        zoomOn2(map, null);
                        await moveToLocation(map, position2, zoomLevel, 500);
                    }
                    openInfoWindow(position, content);
                    currentMarker = marker;
                    if (zoomLevel >= 18) {
                        map.setPitch(Number(footprint.spec.pitchAngle));
                        map.setRotation(Number(footprint.spec.rotationAngle));
                        isElevation = true;
                    }
                };


                // 添加触摸事件处理
                const handleTouchStart = (e, marker) => {
                    if (e.touches.length !== 1) return;

                    touchStartPos = {
                        x: e.touches[0].clientX,
                        y: e.touches[0].clientY,
                        time: Date.now()
                    };
                    isDragging = false;
                };

                const handleTouchMove = (e, marker) => {
                    if (!touchStartPos || e.touches.length !== 1) return;

                    const touch = e.touches[0];
                    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
                    const deltaY = Math.abs(touch.clientY - touchStartPos.y);

                    // 如果移动距离超过阈值，认为是拖拽
                    if (deltaX > 5 || deltaY > 5) {
                        isDragging = true;
                    }
                };

                const handleTouchEnd = async (e, marker, footprint) => {
                    if (!touchStartPos || e.changedTouches.length !== 1) return;

                    const touch = e.changedTouches[0];
                    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
                    const deltaY = Math.abs(touch.clientY - touchStartPos.y);
                    const duration = Date.now() - touchStartPos.time;

                    // 如果是短按且移动距离小，则触发点击事件
                    if (!isDragging && duration < 300 && deltaX < 10 && deltaY < 10) {
                        e.preventDefault();
                        await handleMarkerClick(marker);
                    }

                    touchStartPos = null;
                };

                // 添加事件监听器
                marker.on('click', handleMarkerClick);

                // 为移动端添加触摸事件
                const markerElement = marker.getContent();
                if (markerElement) {
                    markerElement.addEventListener('touchstart', (e) => handleTouchStart(e, marker), {passive: true});
                    markerElement.addEventListener('touchmove', (e) => handleTouchMove(e, marker), {passive: true});
                    markerElement.addEventListener('touchend', (e) => handleTouchEnd(e, marker, footprint));
                }

                // 缓存标记点DOM引用，供抛物线动画使用
                const imgElement = markerContent.querySelector('img');
                if (imgElement) {
                    markerCache.set(footprint.spec.name, imgElement);
                }
                map.add(marker);
            } catch (error) {
                console.error('创建标记失败:', error, footprint);
            }
        });

        currentIndex += batchSize;
        if (currentIndex < sortedFootprintData.length) {
            // 添加100ms的延迟后再渲染下一批
            setTimeout(() => {
                requestIdleCallback(renderBatch);
            }, 0);
        }
    };

    renderBatch();

    // 清理函数
    const cleanup = () => {
        map.off('movestart');
        map.off('moveend', debouncedUpdate);
        map.off('click', handleMapClick);

        const infoWindowElement = document.querySelector('.info-window');
        if (infoWindowElement) {
            infoWindowElement.removeEventListener('click', handleInfoWindowClick);
            const articleBtn = infoWindowElement.querySelector('.article-btn');
            if (articleBtn) {
                articleBtn.removeEventListener('click', handleArticleClick);
            }
        }
    };

    // 在组件卸载时清理事件监听器
    window.addEventListener('unload', cleanup);


    document.getElementById('messageBoards').addEventListener('click', () => {
        window.open('http://www.yunduan019.com/liu', '_blank');
    });

    document.getElementById('zoom-restore').addEventListener('click', () => {
        //显示时间线按钮/缩放按钮/线路按钮
        const timelineBtn = document.getElementById('timeline-btn');
        const zoomButtons = document.getElementById('zoom-buttons');
        const line = document.getElementById('line');
        timelineBtn.classList.remove('hidden-important');
        zoomButtons.classList.remove('hidden-important');
        line.classList.remove('hidden-important');

        const footprintMap = document.getElementById('footprint-map');
        footprintMap.style.width = window.innerWidth + "px";
        const timelineDrawer = document.getElementById('timelineDrawer');
        isTimelineOpen = false;
        timelineDrawer.classList.remove('open');
        const mapControls = document.getElementById('map-controls');
        mapControls.classList.remove('open');

        // 关闭信息窗口
        infoWindow.close();
        //还原仰角和旋转
        if (isElevation) {
            map.setPitch(0);
            map.setRotation(0);
        }
        currentMarker = null;
        const position = new AMap.LngLat(116.397428, 39.90923);
        moveToLocation(map, position, 4, 0);

        // 卸载所有图片
        const cards = document.querySelectorAll('.timeline-card');
        cards.forEach(card => {
            card.style.backgroundImage = 'none';
            card.classList.add('loading');
        });


        // 移除滚动事件监听
        const timeLineBox = document.getElementById('timeLineBox');
        if (timeLineBox) {
            timeLineBox.removeEventListener('scroll', handleScroll);
        }
    });
};
// 优化图层切换
const handleLayerChange = (btn, type, layerState, map, layers) => {
    btn.classList.add('btn-clicked');

    requestAnimationFrame(() => {
        if (type === 'normal' || type === 'satellite') {
            const baseButtons = document.querySelectorAll('.control-btn[data-type="normal"], .control-btn[data-type="satellite"]');
            baseButtons.forEach(button => button.classList.remove('active'));

            const mapContainer = document.getElementById('footprint-map');
            mapContainer.classList.add('map-transitioning');

            requestAnimationFrame(() => {
                btn.classList.add('active');
                layerState.baseLayer = type;

                updateLayers(layerState, layers).then(() => {
                    setTimeout(() => {
                        mapContainer.classList.remove('map-transitioning');
                    }, 500);
                });
            });
        } else {
            btn.classList.toggle('active');
            layerState.overlays[type] = !layerState.overlays[type];

            if (layerState.overlays[type]) {
                const mapContainer = document.getElementById('footprint-map');
                mapContainer.classList.add('map-shake');
                setTimeout(() => {
                    mapContainer.classList.remove('map-shake');
                }, 400);
            }

            updateLayers(layerState, layers);
        }
    });

    setTimeout(() => btn.classList.remove('btn-clicked'), 400);
};

// 优化图层更新
const updateLayers = async (layerState, layers) => {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            // 处理基础图层
            if (layerState.baseLayer === 'satellite') {
                layers.satellite.show();
            } else {
                layers.satellite.hide();
            }

            // 错开叠加图层的更新时间
            setTimeout(() => {
                if (layerState.overlays.road) {
                    layers.road.show();
                } else {
                    layers.road.hide();
                }
            }, 100);

            setTimeout(() => {
                if (layerState.overlays.traffic) {
                    layers.traffic.show();
                } else {
                    layers.traffic.hide();
                }
                resolve();
            }, 200);
        });
    });
};

// 将页面主题 HSL 转换为高德行政区图层可用的 RGBA 颜色
const getThemeRgba = (alpha = 1) => {
    const value = window.FOOTPRINT_CONFIG?.hsla || '';
    const match = String(value).match(/^\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*$/);
    if (!match) {
        return `rgba(236, 72, 153, ${alpha})`;
    }

    const h = (Number(match[1]) % 360) / 360;
    const s = Math.max(0, Math.min(100, Number(match[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(match[3]))) / 100;
    const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        const gray = Math.round(l * 255);
        return `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hueToRgb(p, q, h) * 255);
    const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// 高亮已去过的城市，不改变地图视野和现有足迹标记
const addVisitedCityLayer = (map, footprintData) => {
    if (!window.FOOTPRINT_CONFIG?.highlightVisitedCities || !Array.isArray(footprintData)) {
        return Promise.resolve(null);
    }

    const visitedCitySet = new Set(
        footprintData
            .map(item => item?.spec?.cityAdcode)
            .filter(Boolean)
            .map(adcode => String(adcode))
    );

    if (visitedCitySet.size === 0) {
        return Promise.resolve(null);
    }

    // 异步加载行政区图层插件，确保插件加载完成后再创建高亮图层
    return new Promise(resolve => {
        AMap.plugin('AMap.DistrictLayer', () => {
            try {
                // 创建中国行政区图层：depth 为 2 时可以显示到城市级别
                const visitedCityLayer = new AMap.DistrictLayer.Country({
                    zIndex: 8,
                    SOC: 'CHN',
                    depth: 2,
                    styles: {
                        // 隐藏国家外围边框，避免与地图底图边界重复显示
                        'nation-stroke': '',
                        // 使用主题色显示海岸线，同时降低透明度避免过于抢眼
                        'coastline-stroke': getThemeRgba(0.62),
                        // 隐藏省级边框，只保留城市级别的边界
                        'province-stroke': '',
                        // 统一设置行政区边界线宽度
                        'stroke-width': 1.5,
                        // 根据城市是否去过，分别设置城市边框颜色
                        'city-stroke': properties => {
                            const cityAdcode = properties?.adcode_cit;
                            return visitedCitySet.has(String(cityAdcode))
                                ? getThemeRgba(0.92)
                                : 'rgba(148, 163, 184, 0.24)';
                        },
                        // 只填充已去过的城市，未去过的城市保持透明
                        fill: properties => {
                            const cityAdcode = properties?.adcode_cit;
                            return visitedCitySet.has(String(cityAdcode))
                                ? getThemeRgba(0.28)
                                : '';
                        }
                    }
                });

                // 将创建好的行政区图层添加到地图，并返回图层实例
                map.add(visitedCityLayer);
                resolve(visitedCityLayer);
            } catch (error) {
                // 图层创建失败时不阻塞页面其他功能，返回空值作为降级结果
                console.warn('已去过城市高亮图层创建失败:', error);
                resolve(null);
            }
        });
    });
};

// 添加按钮点击动画
const addButtonAnimation = (button) => {
    button.addEventListener('click', () => {
        button.classList.add('btn-pulse');
        setTimeout(() => {
            button.classList.remove('btn-pulse');
        }, 300);
    });

    // 添加波纹效果
    addRippleEffect(button);

    // 添加悬停提示
    if (button.dataset.tooltip) {
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = button.dataset.tooltip;
        button.appendChild(tooltip);

        button.addEventListener('mouseenter', () => {
            tooltip.classList.add('show');
        });

        button.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });
    }
};

// 添加动画状态管理
const AnimationState = {
    IDLE: 'idle',
    ANIMATING: 'animating',
    PAUSED: 'paused'
};

// 添加按钮波纹效果
const addRippleEffect = (button) => {
    button.addEventListener('click', function (e) {
        const rect = button.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;

        button.appendChild(ripple);

        setTimeout(() => {
            ripple.remove();
        }, 600);
    });
};


// 初始化应用
const initializeApp = async () => {
    try {
        // 创建地图实例
        const map = new AMap.Map('footprint-map', {
            zoom: 4.1,
            center: [116.397428, 39.90923],
            zooms: [2, 26],
            // mapStyle: 'amap://styles/whitesmoke',
            mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/grey',
            viewMode: '3D',
            pitch: 0,
            pitchEnable: true, // 开启俯仰交互
            rotateEnable: true, // 开启旋转交互
            showBuildingBlock: true, // 显示3D楼房立体块
            buildingAnimation: true, // 开启楼房出现动画
            terrain: true, // 开启地形图
            features: ['bg', 'road', 'building', 'point'],
            optimize: true, // 开启优化模式
            resizeEnable: true     // 启用自动适应容器尺寸
        });

        // 等待地图加载完成
        await new Promise(resolve => {
            map.on('complete', resolve);
        });

        // 创建图层
        const layers = {
            satellite: new AMap.TileLayer.Satellite(),
            road: new AMap.TileLayer.RoadNet(),
            traffic: new AMap.TileLayer.Traffic()
        };

        // 添加图层到地图
        Object.values(layers).forEach(layer => {
            map.add(layer);
            layer.hide();
        });

        // 初始化地图功能
        initializeMapFeatures(map, layers);

        // 添加已去过城市高亮图层
        await addVisitedCityLayer(map, window.FOOTPRINT_CONFIG.footprints);

        // 添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);

        showElements();
        renderStats();
        // 为所有控制按钮添加点击动画
        document.querySelectorAll('.control-btn, .zoom-controls button').forEach(button => {
            addButtonAnimation(button);
        });


        // 只在非移动端显示界面元素
        populateTimeline(map);
    } catch (error) {
        console.error('初始化地图时发生错误:', error);
    }
};

// 性能优化：将地图功能初始化封装为单独的函数
const initializeMapFeatures = (map, layers) => {
    // 使用防抖优化事件处理
    const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    // 优化比例尺更新
    const updateScaleText = debounce(() => {
        requestAnimationFrame(() => {
            const originalScaleText = document.querySelector('.amap-scale-text');
            if (originalScaleText) {
                document.querySelector('.map-controls .amap-scale-text').textContent = originalScaleText.textContent;
                const originalScale = document.querySelector('.amap-scale');
                if (originalScale) {
                    originalScale.style.display = 'none';
                }
            }
        });
    }, 100);

    // 添加事件监听
    map.on('zoom', updateScaleText);
    map.on('moveend', updateScaleText);

    // 优化图层控制
    const layerState = {
        baseLayer: 'normal',
        overlays: {
            road: false,
            traffic: false
        }
    };

    // 处理基础图层按钮点击
    document.querySelectorAll('.control-btn[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (type === 'normal' || type === 'satellite') {
                handleLayerChange(btn, type, layerState, map, layers);
            }
        });
    });

    // 处理飞机开关的变化事件
    document.querySelectorAll('.plane-switch input[type="checkbox"]').forEach(checkbox => {
        const type = checkbox.dataset.type;
        checkbox.addEventListener('change', () => {
            layerState.overlays[type] = checkbox.checked;
            updateLayers(layerState, layers);

            // 添加动画效果
            const mapContainer = document.getElementById('footprint-map');
            if (checkbox.checked) {
                mapContainer.classList.add('map-shake');
                setTimeout(() => {
                    mapContainer.classList.remove('map-shake');
                }, 400);
            }
        });
    });

    // 处理缩放按钮点击
    document.getElementById('zoom-in').addEventListener('click', () => {
        map.setZoom(map.getZoom() + 1);
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        map.setZoom(map.getZoom() - 1);
    });

    // 初始化图层状态
    updateLayers(layerState, layers);
};

