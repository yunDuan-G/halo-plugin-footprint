// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
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
        initializeApp();
    };
    checkAMap();

    /* ---------------------- */
    // 初始化右侧时间线抽屉
    // populateTimeline();
    /* ---------------------- */

});

// 添加一个全局变量来跟踪当前激活的卡片
let activeCard = null;

//抛物线动画加载
const loadParabolaAnimation = (card) => {
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
    const markerImage = document.querySelector(`.marker-image img[alt="${cardHeaderContent}"]`);

    if (!markerImage) {
        console.warn('未找到对应的标记图片');
        return;
    }

    const mapRect = markerImage.getBoundingClientRect();
    const mapCenterX = mapRect.left + mapRect.width / 2;
    const mapCenterY = mapRect.top + mapRect.height / 2;

    // 起点和终点
    const startPoint = {x: cardCenterX, y: cardCenterY};
    const endPoint = {x: mapCenterX, y: mapCenterY};

    // 控制点，控制抛物线形状
    const controlPoint = {
        x: (startPoint.x + endPoint.x) / 2,
        y: Math.min(startPoint.y, endPoint.y) - 150
    };

    // 动画参数
    let progress = 0;
    const duration = 500; // 动画持续时间(ms)
    let startTime = null;

    // 绘制抛物线上的箭头
    function drawArrow(x, y, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        // 箭头形状
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-15, -8);
        ctx.moveTo(0, 0);
        ctx.lineTo(-15, 8);
        ctx.strokeStyle = '#42b98';
        ctx.lineWidth = 2;
        ctx.stroke();

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
    function drawDashedCurve() {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, endPoint.x, endPoint.y);

        ctx.setLineDash([6, 4]); // 虚线模式: 5px实线，3px空白
        ctx.strokeStyle = '#42b98';
        ctx.lineWidth = 2;
        // ctx.stroke();
        // ctx.setLineDash([]); // 重置为实线
    }

    // 动画循环
    function animate(timestamp) {
        // 如果当前卡片不是激活的卡片，则停止动画
        if (card !== activeCard) {
            if (card.currentAnimationId) {
                cancelAnimationFrame(card.currentAnimationId);
                card.currentAnimationId = null;
            }
            return;
        }

        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        progress = Math.min(elapsed / duration, 1);

        // 清除画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制完整的虚线抛物线
        drawDashedCurve();

        // 计算当前动画点在曲线上的位置
        const currentPoint = getQuadraticBezierPoint(progress, startPoint, controlPoint, endPoint);

        // 计算当前点的切线角度
        const angle = getQuadraticBezierAngle(progress, startPoint, controlPoint, endPoint);

        // 绘制当前位置的箭头
        drawArrow(currentPoint.x, currentPoint.y, angle);

        // 绘制从起点到当前点的实线部分
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);

        // 为了绘制实线部分，我们需要细分曲线
        const segments = 50;
        for (let i = 0; i <= segments * progress; i++) {
            const t = i / segments;
            const p = getQuadraticBezierPoint(t, startPoint, controlPoint, endPoint);
            if (i === 0) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }

        ctx.strokeStyle = '#42b983';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 继续动画直到完成
        if (progress < 1) {
            card.currentAnimationId = requestAnimationFrame(animate);
        } else {
            card.currentAnimationId = null; // 动画完成后清除 ID
        }
    }

    // 开始动画
    card.currentAnimationId = requestAnimationFrame(animate);

    // 响应窗口大小变化
    const resizeHandler = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeHandler);

    // 清理函数
    const cleanup = () => {
        if (card.currentAnimationId) {
            cancelAnimationFrame(card.currentAnimationId);
            card.currentAnimationId = null;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        window.removeEventListener('resize', resizeHandler);
        card.removeEventListener('mouseleave', handleLeave);
    };

    const handleLeave = debounce(cleanup, 100);
    card.addEventListener('mouseleave', handleLeave);
};

//渲染抽屉中的时间线
const populateTimeline = async (map) => {
    const timelineContainer = document.getElementById('timeline-container');
    const footprints = window.FOOTPRINT_CONFIG.footprints;

    if (!Array.isArray(footprints) || footprints.length === 0) {
        timelineContainer.innerHTML = '<p>No footprints available.</p>';
        return;
    }

    timelineContainer.innerHTML = ''; // Clear existing content

    footprints.forEach(footprint => {
        const card = document.createElement('div');
        card.className = 'timeline-card';
        card.style.backgroundImage = `url(${footprint.spec.image})`;
        card.style.backgroundSize = 'cover';
        card.style.backgroundPosition = 'center';

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

        card.appendChild(header);
        card.appendChild(time);
        card.appendChild(description);

        timelineContainer.appendChild(card);
    });

    const timelineBtn = document.getElementById('timeline-btn');
    const timelineDrawer = document.getElementById('timeline-drawer');
    const closeDrawerBtn = document.getElementById('close-drawer');

    // 打开抽屉
    timelineBtn.addEventListener('click', () => {
        timelineDrawer.classList.add('open');
    });

    // 合上抽屉
    closeDrawerBtn.addEventListener('click', () => {
        timelineDrawer.classList.remove('open');
    });

    // 获取所有 timeline-card 元素
    const timelineCards = document.querySelectorAll('.timeline-card');

    // 为每个卡片绑定鼠标悬停事件，使用防抖优化
    timelineCards.forEach(card => {
        let debounceTimer;

        const handleEnter = () => {
            // 设置当前激活的卡片
            activeCard = card;
            
            zoomOn(map, card);
            const zoom = 14;

            const cardHeader = card.querySelector('.card-header');
            const cardHeaderContent = cardHeader.textContent;
            const footprint = window.FOOTPRINT_CONFIG.footprints.find(
                    f => f.spec.name === cardHeaderContent
            );
            const position = new AMap.LngLat(118.161927, 30.138115);
            const position2 = new AMap.LngLat(parseFloat(footprint.spec.longitude),
                    parseFloat(footprint.spec.latitude));
            moveToLocation(map, position, 4);
            moveToLocation(map, position2, zoom);
        };

        const handleLeave = () => {
            debounceTimer = setTimeout(() => {
                // 如果离开的是当前激活的卡片，则清除激活状态
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
            }, 100);
        };

        card.addEventListener('mouseenter', handleEnter);
        card.addEventListener('mouseleave', handleLeave);
    });
};

// 存储绑定的函数，方便解绑
let boundZoomStart, boundZoom, boundZoomEnd;

function zoomOn(map, card) {
    console.log("绑定事件!");

    // 存储绑定的函数
    boundZoomStart = mapZoomstart.bind(null, card);
    boundZoom = mapZoom.bind(null, card);
    boundZoomEnd = mapZoomend.bind(null, card);

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

//地图开始缩放
function mapZoomstart() {
    console.log("缩放开始");
}

//地图缩放中
function mapZoom() {
    console.log("正在缩放");
}

//缩放结束
function mapZoomend(card) {
    console.log("缩放结束");
    if (card != null) {
        loadParabolaAnimation(card);
    }
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
const moveToLocation = (map, position, Zoom) => {
    return new Promise((resolve) => {
        // 启用动画
        map.setStatus({animateEnable: true});

        // 设置缩放级别
        map.setZoom(Zoom);

        // 平移到目标位置
        map.panTo(position);

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

// 优化标记点创建
const createMarker = (spec) => {
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-marker';

    const markerImage = document.createElement('div');
    markerImage.className = 'marker-image';

    const img = document.createElement('img');
    img.src = spec.image || 'https://www.lik.cc/upload/loading8.gif';
    img.alt = spec.name || '足迹标记';

    markerImage.appendChild(img);
    markerContent.appendChild(markerImage);

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

// 优化信息窗口内容创建
function createInfoWindow(spec) {
    // 确保所有字段都有默认值
    const {
        image = '',
        name = '',
        footprintType = '',
        createTime = '',
        address = '',
        description = '',
        article = ''
    } = spec;

    // 格式化时间
    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/\//g, '-');
    };

    // 构建图片HTML
    const imageHtml = image ? `
        <div class="image">
            <img src="${image}" alt="${name}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">
            <div class="image-info">
                <h3 class="title">${name}</h3>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
                            <path d="M9 12h6"></path>
                        </svg>
                        ${footprintType || '未知类型'}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formatDate(createTime)}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        ${address || '未知位置'}
                    </span>
                </div>
                ${description ? `<p class="description">${description}</p>` : ''}
                ${article ? `
                    <a href="${article}" target="_blank" class="article-btn">
                        查看文章
                        <div class="arrow-wrapper">
                            <div class="arrow"></div>
                        </div>
                    </a>
                ` : ''}
            </div>
        </div>
    ` : `
        <div class="image">
            <img src="https://www.lik.cc/upload/loading8.gif" alt="${name}" style="position: absolute; width: 100%; height: 100%; object-fit: cover;">
            <div class="image-info">
                <h3 class="title">${name}</h3>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 7v10a4 4 0 004 4h10a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4z"></path>
                            <path d="M9 12h6"></path>
                        </svg>
                        ${footprintType || '未知类型'}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        ${formatDate(createTime)}
                    </span>
                </div>
                <div class="meta">
                    <span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        ${address || '未知位置'}
                    </span>
                </div>
                ${description ? `<p class="description">${description}</p>` : ''}
                ${article ? `
                    <a href="${article}" target="_blank" class="article-btn">
                        查看文章
                        <div class="arrow-wrapper">
                            <div class="arrow"></div>
                        </div>
                    </a>
                ` : ''}
            </div>
        </div>
    `;

    return `
        <div class="info-window">
            ${imageHtml}
        </div>
    `;
}

// 性能优化：使用防抖优化事件处理
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

// 添加足迹标记
const addFootprintMarkers = (map, footprintData) => {
    // 创建信息窗体
    let infoWindow = new AMap.InfoWindow({
        isCustom: true,
        autoMove: false,
        offset: new AMap.Pixel(0, -10)
    });

    // 用于存储当前打开的标记
    let currentMarker = null;

    // 添加全局点击事件监听器
    // 添加点击地图事件监听器，用于关闭信息窗口
    map.on('click', () => {
        if (currentMarker) {
            infoWindow.close();
            currentMarker = null;
        }
    });

    // 打开信息窗口的函数
    const openInfoWindow = (position, content) => {
        infoWindow.setContent(content);
        infoWindow.open(map, position);

        // 阻止信息窗口上的点击事件冒泡到地图
        requestAnimationFrame(() => {
            const infoWindowElement = document.querySelector('.info-window');
            if (infoWindowElement) {
                infoWindowElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                });

                // 为文章链接添加点击事件处理
                const articleBtn = infoWindowElement.querySelector('.article-btn');
                if (articleBtn) {
                    articleBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                }
            }
        });
    };

    // 分批次渲染
    const batchSize = 10;
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
                    offset: new AMap.Pixel(0, 0)
                });

                marker.on('click', async () => {
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

                    // 检查是否需要移动地图
                    const currentPos = map.getCenter();
                    const distance = position.distance(currentPos);
                    const currentZoom = map.getZoom();

                    // 如果距离超过1公里或缩放级别不够，需要移动地图
                    const needsMovement = distance > 1000 || currentZoom < 13;

                    if (needsMovement) {
                        // 先移动地图，等待移动完成后再打开窗口
                        await moveToLocation(map, position, 14);
                    }
                    // 打开信息窗口
                    openInfoWindow(position, content);
                    currentMarker = marker;
                });

                map.add(marker);
            } catch (error) {
                console.error('创建标记失败:', error, footprint);
            }
        });

        currentIndex += batchSize;
        if (currentIndex < footprintData.length) {
            requestIdleCallback(renderBatch);// 利用空闲时间渲染
        }
    };

    renderBatch();// 启动首次渲染

    document.getElementById('zoom-restore').addEventListener('click', () => {
        const timelineDrawer = document.getElementById('timeline-drawer');
        timelineDrawer.classList.remove('open');

        // 关闭信息窗口
        infoWindow.close();
        currentMarker = null;

        const position = new AMap.LngLat(116.397428, 39.90923);
        moveToLocation(map, position, 4);
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

// 初始化应用
const initializeApp = async () => {
    try {
        // 创建地图实例
        const map = new AMap.Map('footprint-map', {
            zoom: 4,
            center: [116.397428, 39.90923],
            mapStyle: window.FOOTPRINT_CONFIG.mapStyle || 'amap://styles/normal',
            viewMode: '2D',
            pitch: 0,
            features: ['bg', 'road', 'building', 'point'],
            showBuildingBlock: true,
            showIndoorMap: false,  // 关闭室内地图
            animateEnable: false  // 初始禁用动画
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

        // 显示界面元素
        showElements();

        // 为所有控制按钮添加点击动画
        document.querySelectorAll('.control-btn, .zoom-controls button').forEach(button => {
            addButtonAnimation(button);
        });
        populateTimeline(map)
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
