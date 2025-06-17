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
    }

    // 打印插件信息
    console.log(
            '%c足迹插件%c🗺️ 记录生活轨迹，分享旅途故事\n%c作者 Handsome %cwww.lik.cc',
            'background: #42b983; color: white; padding: 2px 4px; border-radius: 3px;',
            'color: #42b983; padding: 2px 4px;',
            'color: #666; padding: 2px 4px;',
            'color: #42b983; text-decoration: underline; padding: 2px 4px;'
    );

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


    /* ---------------------- */
    // 初始化右侧时间线抽屉
    // populateTimeline();
    /* ---------------------- */

    window.FOOTPRINT_CONFIG.footprints.forEach(fp => {
        if (fp.spec.image) {
            const img = new Image();
            img.src = fp.spec.image;
        }
    });
});

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// 添加一个全局变量来跟踪当前激活的卡片
let activeCard = null;

//抛物线动画加载
const loadParabolaAnimation = (card, map) => {
    // 如果当前卡片不是激活的卡片，则不执行动画
    if (card !== activeCard) {
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

    // 获取card对应的标记点
    const footprint = window.FOOTPRINT_CONFIG.footprints.find(
            f => f.spec.name === cardHeaderContent
    );
    console.log(footprint)

    if (!footprint) {
        console.warn('未找到对应的足迹数据');
        return;
    }

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
    console.log(mapCenter)

    // 为每个标记点创建动画
    const animations = mapCenter.map(center => {
        // 起点和终点
        const startPoint = {x: cardCenterX, y: cardCenterY};
        const endPoint = {x: center.mapCenterX, y: center.mapCenterY - 46};

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
        isAnimating = false;
        if (card.currentAnimationId) {
            cancelAnimationFrame(card.currentAnimationId);
            card.currentAnimationId = null;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.removeEventListener('resize', resizeHandler);
        card.removeEventListener('mouseleave', handleLeave);
        // 清除引用
        card = null;
    };

    const handleLeave = debounce(cleanup, 100);
    card.addEventListener('mouseleave', handleLeave);
};

const position = null;

//标记点偏移量
const offsetLng = 0.025;

//是否打开时间线
let isTimelineOpen = false;

//是否打开仰角和旋转
let isElevation = false;

// Configuration
const config = {
    cols: isMobile ? 1 : 2 //每行显示数量
};

// 添加图片预加载和缓存
const imageCache = new Map();

//渲染抽屉中的时间线
const populateTimeline = async (map) => {
    const timelineContainer = document.getElementById('timeline-container');
    const footprints = window.FOOTPRINT_CONFIG.footprints;

    if (!Array.isArray(footprints) || footprints.length === 0) {
        timelineContainer.innerHTML = '<p>No footprints available.</p>';
        return;
    }

    timelineContainer.innerHTML = ''; // 清除现有内容

    const timeLineBox = document.createElement('div');
    timeLineBox.className = 'timeLineBox';

    const cols = config.cols;
    const rows = Math.ceil(footprints.length / cols);

    // 创建所有卡片但不立即加载图片
    for (let row = 1; row <= rows; row++) {
        const isReverse = row % 2 === 0;

        const timeline = document.createElement('div');
        timeline.className = 'timeline';
        if (isReverse) timeline.classList.add('reverse');

        for (let item = 1; item <= cols; item++) {
            const index = (row - 1) * cols + item;
            if (index > footprints.length) continue;

            const footprint = footprints[index - 1];

            const card = document.createElement('div');
            card.className = 'timeline-card loading';

            // 添加 loading 指示器
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-indicator';
            card.appendChild(loadingIndicator);

            const header = document.createElement('div');
            header.className = 'card-header';
            header.textContent = footprint.spec.name || 'Unnamed Footprint';

            const time = document.createElement('div');
            time.className = 'card-time';
            time.textContent = footprint.spec.createTime
                    ? new Date(footprint.spec.createTime).toLocaleString('zh-CN')
                    : 'Unknown Time';

            const description = document.createElement('div');
            description.className = 'card-description';
            description.textContent = footprint.spec.description || 'No description available.';

            // 添加查看按钮
            const viewButton = document.createElement('button');
            viewButton.className = 'view-button';
            viewButton.innerHTML = `
                <span>查看详情</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                </svg>
            `;

            // 添加点击事件处理
            viewButton.addEventListener('click', async (e) => {
                e.stopPropagation();

                // 清除抛物线动画
                if (card.currentAnimationId) {
                    cancelAnimationFrame(card.currentAnimationId);
                    card.currentAnimationId = null;
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

                const cardHeader = card.querySelector('.card-header');
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

            card.appendChild(header);
            card.appendChild(time);
            card.appendChild(description);
            card.appendChild(viewButton);

            const timelineItem = document.createElement('div');
            timelineItem.className = 'timelineItem';
            timelineItem.style.width = `${100 / cols}%`;

            const itemTitle = document.createElement('div');
            itemTitle.className = 'itemTitle';
            itemTitle.appendChild(card);

            // 如果这是最后一项，则添加箭头
            if (index === footprints.length) {
                const arrowContainer = document.createElement('div');
                if (isReverse) {
                    arrowContainer.className = 'to-btn-left';
                    const arrow = document.createElement('div');
                    arrow.className = 'to_left';
                    arrow.style.borderRightColor = 'gray';
                    arrowContainer.appendChild(arrow);
                } else {
                    arrowContainer.className = 'to-btn-right';
                    const arrow = document.createElement('div');
                    arrow.className = 'to_right';
                    arrow.style.borderLeftColor = 'gray';
                    arrowContainer.appendChild(arrow);
                }
                timelineItem.appendChild(arrowContainer);
            }

            const itemDot = document.createElement('div');
            itemDot.className = 'itemDot';

            timelineItem.appendChild(itemTitle);
            timelineItem.appendChild(itemDot);
            timeline.appendChild(timelineItem);
        }
        timeLineBox.appendChild(timeline);
    }
    timelineContainer.appendChild(timeLineBox);

    // 添加时间线按钮事件处理
    const timelineBtn = document.getElementById('timeline-btn');
    const timelineDrawer = document.getElementById('timeline-drawer');
    const closeDrawerBtn = document.getElementById('close-drawer');

    // 打开抽屉
    timelineBtn.addEventListener('click', () => {
        const footprintMap = document.getElementById('footprint-map');
        const number = window.innerWidth - 650;
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
        /*if (!isMobile) {
            const position = new AMap.LngLat(116.397428 + 20, 39.90923);
            moveToLocation(map, position, 4, 0);
        }*/

        // 延迟加载图片
        setTimeout(() => {
            const cards = document.querySelectorAll('.timeline-card');
            cards.forEach((card, index) => {
                const cardHeader = card.querySelector('.card-header');
                const cardHeaderContent = cardHeader.textContent;
                const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                        f => f.spec.name === cardHeaderContent
                );

                if (footprint && footprint.spec.image) {
                    // 添加最小显示时间
                    const startTime = Date.now();
                    const minDisplayTime = 1000; // 最小显示1秒

                    const img = new Image();
                    img.onload = () => {
                        const elapsedTime = Date.now() - startTime;
                        const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

                        setTimeout(() => {
                            card.style.backgroundImage = `url(${footprint.spec.image})`;
                            card.style.backgroundSize = 'cover';
                            card.style.backgroundPosition = 'center';
                            card.classList.remove('loading');
                        }, remainingTime);
                    };
                    img.onerror = () => {
                        card.classList.remove('loading');
                        console.warn('Failed to load image:', footprint.spec.image);
                    };
                    img.src = footprint.spec.image;
                } else {
                    card.classList.remove('loading');
                }
            });
        }, 100); // 延迟100ms开始加载图片
    });

    // 合上抽屉
    closeDrawerBtn.addEventListener('click', () => {
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
    });

    // 为每个卡片绑定鼠标悬停事件
    const timelineCards = document.querySelectorAll('.timeline-card');
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

                // 关闭已打开的信息窗口
                const allOverlays = map.getAllOverlays();
                allOverlays.forEach(overlay => {
                    if (overlay instanceof AMap.InfoWindow) {
                        overlay.close();
                    }
                });

                zoomOn(map, card);
                const zoom = 14;

                const cardHeader = card.querySelector('.card-header');
                const cardHeaderContent = cardHeader.textContent;
                const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                        f => f.spec.name === cardHeaderContent
                );
                const position2 = new AMap.LngLat(
                        parseFloat(isTimelineOpen ? footprint.spec.longitude + offsetLng : footprint.spec.longitude),
                        parseFloat(footprint.spec.latitude)
                );

                const currentPos = map.getCenter();
                const distance = position2.distance(currentPos);
                const currentZoom = map.getZoom();
                const needsMovement = distance > 1000 || currentZoom < 13;

                const metadataNames = footprint.spec.metadataNames;
                if (metadataNames && metadataNames.length > 0 &&
                        !(metadataNames.length === 1 && metadataNames.includes(footprint.metadata.name))) {
                    const name = footprint.metadata.name;
                    const metadataName = footprint.spec.metadataNames.includes(name);
                    const positions = metadataNames
                            .map(metadataName => window.FOOTPRINT_CONFIG.footprints.find(
                                    f => f.metadata.name === metadataName
                            ))
                            .filter(Boolean);
                    if (!metadataName) {
                        positions.push(footprint);
                    }

                    const allOverlays = map.getAllOverlays();
                    const newOverlays = positions
                            .map(value => allOverlays.find(
                                    f => f._position.lng === value.spec.longitude && f._position.lat === value.spec.latitude
                            ))
                            .filter(Boolean);

                    const byOverlays = map.getFitZoomAndCenterByOverlays(newOverlays, [350, 120, 60, 680]);
                    const newposition = new AMap.LngLat(byOverlays[1].lng, byOverlays[1].lat);

                    if (!byOverlays[0].toString().startsWith(currentZoom)) {
                        await moveToLocation(map, newposition, byOverlays[0], 0);
                    } else {
                        loadParabolaAnimation(card, map);
                    }
                } else {
                    if (needsMovement) {
                        console.log(123)
                        await moveToLocation(map, position2, zoom, 0);
                    } else {
                        loadParabolaAnimation(card, map);
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
            return new Promise((resolve) => {
                debounceTimer = setTimeout(() => {
                    if (activeCard === card) {
                        activeCard = null;
                    }
                    zoomOff(map);
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
            await handleLeave();
            handleEnter();
        });
        card.addEventListener('mouseleave', handleLeave);
    });
};

// 存储绑定的函数，方便解绑
let boundZoomStart, boundZoom, boundZoomEnd;

//绑定事件
function zoomOn(map, card) {
    console.log("绑定事件!");

    // 存储绑定的函数
    boundZoomStart = mapZoomstart.bind(null, card);
    boundZoom = mapZoom.bind(null, card);
    boundZoomEnd = mapZoomend.bind(null, card, map);

    map.on('zoomstart', boundZoomStart);
    map.on('zoomchange', boundZoom);
    map.on('zoomend', boundZoomEnd);
}

function zoomOff(map) {
    console.log("解除事件绑定!");

    // 使用存储的函数引用解绑
    map.off('zoomstart', boundZoomStart);
    map.off('zoomchange', boundZoom);
    map.off('zoomend', boundZoomEnd);
}

// 存储绑定的函数，方便解绑
let boundZoomStart2, boundZoom2, boundZoomEnd2;

//绑定事件
function zoomOn2(map, card) {
    console.log("绑定事件2!");

    // 存储绑定的函数
    boundZoomStart2 = mapZoomstart.bind(null, card);
    boundZoom2 = mapZoom.bind(null, card);
    boundZoomEnd2 = mapZoomend.bind(null, card, map);

    map.on('zoomstart', boundZoomStart2);
    map.on('zoomchange', boundZoom2);
    map.on('zoomend', boundZoomEnd2);
}

function zoomOff2(map) {
    console.log("解除事件绑定2!");

    // 使用存储的函数引用解绑
    map.off('zoomstart', boundZoomStart2);
    map.off('zoomchange', boundZoom2);
    map.off('zoomend', boundZoomEnd2);
}

//地图开始缩放
function mapZoomstart() {
    console.log("缩放开始");
}

//地图缩放中
function mapZoom() {
    console.log("正在缩放");
}

//缩放结束
function mapZoomend(card, map) {
    console.log("缩放结束");
    if (card != null) {
        loadParabolaAnimation(card, map);
    } else {
        zoomOff2(map);
        calculateTheNewCenterPoint(map);
    }
}

// 计算打开抽屉后，中间点的偏移像素
const calculateTheNewCenterPoint = (map) => {
    if (!isTimelineOpen) {
        return;
    }

    const drawer = document.getElementById("timeline-drawer");
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

        //防止缩放级别相同时，不执行抛物线问题
        const currentZoom = map.getZoom();
        if (currentZoom === Zoom) {
            map.setZoom(Zoom + 1);
        }

        // 平移到目标位置
        map.panTo(position);

        // 延迟缩放
        setTimeout(() => {
            // 强制设置新的缩放级别（即使相同也设置）
            map.setZoom(Zoom); // 然后设置目标值
        }, time); // 2-second delay


        // 等待动画完成
        const checkAnimation = () => {
            if (!map.isMoving && !map.isZooming) {
                resolve();
            } else {
                requestAnimationFrame(checkAnimation);
            }
        };
        checkAnimation();
    });
};


const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';

    const image = spec.image.replace("!w100", "!A100");

    // 使用图片压缩服务
    const compressedImageUrl = spec.image ? image : 'https://www.lik.cc/upload/loading8.gif';

    markerContent.innerHTML = `
        <div class="marker-image">
            <img src="${compressedImageUrl}"
                 alt="${spec.name || '足迹标记'}"
                 decoding="async">
        </div>
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
const debounce = (func, wait, immediate = false) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            if (!immediate) func(...args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func(...args);
    };
};

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
                console.log(11111111111)
                map.setPitch(0);
                map.setRotation(0);
                // map.panBy(-60, (window.innerHeight / 4) + 260);
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

    const renderBatch = () => {
        const batch = footprintData.slice(currentIndex, currentIndex + batchSize);
        batch.forEach(footprint => {
            if (!Array.isArray(footprintData) || footprintData.length === 0) {
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
                const marker = new AMap.Marker({
                    position: position,
                    content: createMarker(footprint.spec),
                    anchor: 'bottom-center',
                    offset: new AMap.Pixel(0, -30),
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
                    if (zoomLevel > 19) {
                        map.setPitch(45);
                        map.setRotation(-100);
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

                map.add(marker);
            } catch (error) {
                console.error('创建标记失败:', error, footprint);
            }
        });

        currentIndex += batchSize;
        if (currentIndex < footprintData.length) {
            requestIdleCallback(renderBatch);
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
        const timelineDrawer = document.getElementById('timeline-drawer');
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

// 添加按钮点击动画
const addButtonAnimation = (button) => {
    button.addEventListener('click', () => {
        button.classList.add('btn-pulse');
        setTimeout(() => {
            button.classList.remove('btn-pulse');
        }, 300);
    });
};

// 添加动画状态管理
const AnimationState = {
    IDLE: 'idle',
    ANIMATING: 'animating',
    PAUSED: 'paused'
};


// 初始化应用
const initializeApp = async (isMobile) => {
    try {
        // 创建地图实例
        const map = new AMap.Map('footprint-map', {
            zoom: 4,
            center: [116.397428, 39.90923],
            zooms: [2, 26],
            mapStyle: 'amap://styles/light',
            // mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/normal',
            viewMode: isMobile ? '2D' : '3D',
            pitch: 0,
            features: isMobile ? ['bg', 'road', 'point'] : ['bg', 'road', 'building', 'point'],
            showBuildingBlock: !isMobile, // 移动端不显示建筑物
            optimize: true, // 开启优化模式
            resizeEnable: true     // 启用自动适应容器尺寸
        });

        // 等待地图加载完成
        await new Promise(resolve => {
            map.on('complete', resolve);
        });

        // 创建图层
        const layers = {
            road: new AMap.TileLayer.RoadNet(),
        };

        // 添加图层到地图
        Object.values(layers).forEach(layer => {
            map.add(layer);
            layer.hide();
        });

        // 初始化地图功能
        initializeMapFeatures(map, layers);

        // 添加足迹标记
        addFootprintMarkers(map, window.FOOTPRINT_CONFIG.footprints);

        showElements();
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