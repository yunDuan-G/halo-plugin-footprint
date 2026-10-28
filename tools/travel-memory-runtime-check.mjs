/**
 * 前台初始化顺序自检：在真实 Chromium 中打开足迹页，捕获未处理异常。
 *
 * 用法：node tools/travel-memory-runtime-check.mjs
 * 可通过 PAGE_URL / CHROME_PATH / CDP_PORT 覆盖默认值。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const chromePath = process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = Number(process.env.CDP_PORT || 9350);
const pageUrl = process.env.PAGE_URL || 'http://localhost:8090/footprints';
const viewportWidth = Number(process.env.VIEWPORT_WIDTH || 1600);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT || 1000);
const profile = `${process.env.TEMP || '/tmp'}/footprint-runtime-${Date.now()}`;
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

mkdirSync(profile, { recursive: true });
const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1000',
    `--user-data-dir=${profile}`,
    'about:blank'
], { stdio: 'ignore' });

let ws;
try {
    await sleep(2500);
    const targets = await (await fetch(`${base}/json/list`)).json();
    const target = targets.find(item => item.type === 'page');
    if (!target) throw new Error('没有找到可用的页面 target');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
} catch (error) {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
    throw error;
}

let sequence = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        exceptions.push(String(details.exception?.description || details.text));
    } else if (message.method === 'Runtime.consoleAPICalled' &&
        message.params.type === 'error') {
        consoleErrors.push(message.params.args
            .map(argument => argument.value ?? argument.description ?? '')
            .join(' '));
    }
});

function send(method, params = {}) {
    return new Promise(resolve => {
        const id = ++sequence;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.result?.exceptionDetails) {
        const details = result.result.exceptionDetails;
        throw new Error(details.exception?.description || details.text || '页面脚本求值失败');
    }
    return result.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth <= 820
});
if (process.env.MOBILE_TOUCH === '1') {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
if (process.env.REDUCED_MOTION === '1') {
    await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
}
await send('Page.navigate', { url: pageUrl });
await sleep(2000);
if (process.env.PROBE_AUDIO === '1') {
    await evaluate(`(() => {
        window.__audioPlayProbe = { calls: [], resolved: 0, rejected: [] };
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (...args) {
            const probe = window.__audioPlayProbe;
            probe.calls.push(this.currentSrc || this.src || '');
            const result = originalPlay.apply(this, args);
            if (result?.then) {
                result.then(
                    () => { probe.resolved += 1; },
                    error => { probe.rejected.push(error?.name || 'rejected'); }
                );
            }
            return result;
        };
        return true;
    })()`);
}
if (process.env.MUTED_AUDIO_WARMUP === '1') {
    await evaluate(`(() => {
        window.__mutedWarmup = { attempted: true, resolved: false, rejected: null };
        const media = new Audio('/plugins/footprint/assets/static/audio/shelf-select.mp3');
        media.muted = true;
        window.__mutedMedia = media;
        media.play().then(
            () => { window.__mutedWarmup.resolved = true; },
            error => { window.__mutedWarmup.rejected = error?.name || 'rejected'; }
        );
        return true;
    })()`);
}
if (process.env.ENABLE_CITY_FILL === '1') {
    await evaluate(`localStorage.setItem('travelMemoryCityFill', '1'); location.reload(); true`);
}
await sleep(12000);
if (process.env.OPEN_TICKETS === '1') {
    await evaluate(`document.getElementById('ticketGalleryBtn')?.click(); true`);
    await sleep(2500);
}
let framePoint = null;
let buildingState = null;
let booksOpenedByTrustedClick = false;
if (process.env.OPEN_BOOKS_TRUSTED === '1') {
    const entryPoint = JSON.parse(await evaluate(`JSON.stringify((() => {
        const button = document.getElementById('memoryShelfBtn');
        if (!button || button.hidden) return null;
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })())`));
    if (entryPoint) {
        await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: entryPoint.x,
            y: entryPoint.y
        });
        await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: entryPoint.x,
            y: entryPoint.y,
            button: 'left',
            clickCount: 1
        });
        await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: entryPoint.x,
            y: entryPoint.y,
            button: 'left',
            clickCount: 1
        });
        booksOpenedByTrustedClick = true;
        await sleep(process.env.INSPECT_BUILDING === '1' ? 60 : 7000);
    }
}
if (process.env.OPEN_BOOKS === '1') {
    if (!booksOpenedByTrustedClick) {
        await evaluate(`document.getElementById('memoryShelfBtn')?.click(); true`);
        if (process.env.INSPECT_BUILDING === '1') await sleep(60);
    }
    if (process.env.INSPECT_BUILDING === '1') {
        buildingState = JSON.parse(await evaluate(`JSON.stringify((() => {
            const building = document.getElementById('msBuilding');
            if (!building) return null;
            const icon = building.querySelector('.ms-binding-icon');
            const book = building.querySelector('.ms-binding-book');
            const cover = building.querySelector('.ms-binding-cover');
            const thread = building.querySelector('.ms-binding-thread');
            return {
                role: building.getAttribute('role'),
                icon: !!icon,
                book: !!book,
                cover: !!cover,
                thread: !!thread,
                bookAnimation: getComputedStyle(book).animationName,
                coverAnimation: getComputedStyle(cover).animationName,
                threadAnimation: getComputedStyle(thread).animationName
            };
        })())`));
    }
    await sleep(7000);
    if (process.env.NEXT_BOOK === '1') {
        await evaluate(`document.querySelector('.ms-rail-item[data-ms-rail="1"]')?.click(); true`);
        await sleep(1800);
    }
    if (process.env.SCROLL_BOOK === '1') {
        await evaluate(`(() => {
            const stage = document.getElementById('msStage');
            if (!stage) return false;
            stage.dispatchEvent(new WheelEvent('wheel', {
                deltaY: 180,
                bubbles: true,
                cancelable: true
            }));
            return true;
        })()`);
        await sleep(1000);
    }
    framePoint = JSON.parse(await evaluate(`JSON.stringify((() => {
        const action = document.querySelector('.ms-wall-frame-action');
        if (!action || action.hidden) return null;
        const rect = action.getBoundingClientRect();
        return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
        };
    })())`));
    if (process.env.CLICK_FRAME === '1' && framePoint) {
        await evaluate(`document.querySelector('.ms-wall-frame-action')?.click(); true`);
        await sleep(2600);
        if (process.env.CLICK_BACK === '1') {
            await evaluate(`document.getElementById('memoryShelfBack')?.click(); true`);
            await sleep(1300);
        }
    }
}
if (process.env.OPEN_BOOKS !== '1' && process.env.SCROLL_BOOK === '1') {
    await evaluate(`(() => {
        const stage = document.getElementById('msStage');
        if (!stage) return false;
        stage.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 180,
            bubbles: true,
            cancelable: true
        }));
        return true;
    })()`);
    await sleep(1000);
}
if (process.env.TRUSTED_WHEEL === '1') {
    const stagePoint = JSON.parse(await evaluate(`JSON.stringify((() => {
        const rect = document.getElementById('msStage')?.getBoundingClientRect();
        return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null;
    })())`));
    if (stagePoint) {
        await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: stagePoint.x,
            y: stagePoint.y
        });
        await send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: stagePoint.x,
            y: stagePoint.y,
            deltaX: 0,
            deltaY: 180
        });
        await sleep(900);
    }
}
if (process.env.CLICK_SOUND_WAKE === '1') {
    const wakePoint = JSON.parse(await evaluate(`JSON.stringify((() => {
        const button = document.getElementById('memoryShelfSoundWake');
        if (!button || button.hidden) return null;
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })())`));
    if (wakePoint) {
        await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: wakePoint.x,
            y: wakePoint.y,
            button: 'left',
            clickCount: 1
        });
        await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: wakePoint.x,
            y: wakePoint.y,
            button: 'left',
            clickCount: 1
        });
        await sleep(500);
    }
}
if (process.env.TRUSTED_WHEEL_AFTER_WAKE === '1') {
    const stagePoint = JSON.parse(await evaluate(`JSON.stringify((() => {
        const rect = document.getElementById('msStage')?.getBoundingClientRect();
        return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null;
    })())`));
    if (stagePoint) {
        await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: stagePoint.x,
            y: stagePoint.y
        });
        await send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: stagePoint.x,
            y: stagePoint.y,
            deltaX: 0,
            deltaY: 180
        });
        await sleep(900);
    }
}

const stateText = await evaluate(`JSON.stringify({
    title: document.title,
    body: document.body.className,
    toolbar: document.getElementById('footprintToolbar')?.className || '',
    dock: document.getElementById('footprintContentDock')?.className || '',
    intro: document.getElementById('pageIntro')?.className || '',
    globeChildren: document.getElementById('cesiumContainer')?.children.length || 0,
    configuredFootprints: window.FOOTPRINT_CONFIG?.footprints?.length ?? -1,
    introTotal: document.getElementById('introTotal')?.textContent || '',
    introCities: document.getElementById('introCities')?.textContent || '',
    introProvinces: document.getElementById('introProvinces')?.textContent || '',
    latest: document.getElementById('introLatestRoute')?.textContent || '',
    recentTrip: document.getElementById('homeRecentTripTitle')?.textContent || '',
    recentPhotos: document.getElementById('homeRecentTripPhotos')?.children.length || 0,
    loadedPhotos: [...document.querySelectorAll('#homeRecentTripPhotos img')]
        .filter(image => image.complete && image.naturalWidth > 0).length,
    audioAssets: performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/audio/')).length,
    userActivation: navigator.userActivation ? {
        isActive: navigator.userActivation.isActive,
        hasBeenActive: navigator.userActivation.hasBeenActive
    } : null,
    soundWake: (() => {
        const button = document.getElementById('memoryShelfSoundWake');
        return button ? {
            hidden: button.hidden,
            text: button.textContent.trim(),
            nudged: button.classList.contains('is-nudged'),
            rect: (() => {
                const r = button.getBoundingClientRect();
                return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
            })()
        } : null;
    })(),
    audioPlayProbe: window.__audioPlayProbe || null,
    mutedAudioWarmup: window.__mutedWarmup || null,
    shelfHeader: (() => {
        const actions = document.querySelector('#memoryShelf .ms-actions')?.getBoundingClientRect();
        const title = document.getElementById('memoryShelfTitle')?.getBoundingClientRect();
        return {
            actions: actions ? [Math.round(actions.left), Math.round(actions.top), Math.round(actions.right), Math.round(actions.bottom)] : null,
            title: title ? [Math.round(title.left), Math.round(title.top), Math.round(title.right), Math.round(title.bottom)] : null,
            titleActionsOverlap: !!(actions && title && actions.left < title.right && actions.right > title.left &&
                actions.top < title.bottom && actions.bottom > title.top)
        };
    })(),
    recentTripHidden: document.getElementById('homeRecentTrip')?.hidden ?? true,
    atmosphereAnimation: getComputedStyle(document.getElementById('homeAtmosphere')).animationName,
    hintAnimation: getComputedStyle(document.querySelector('.intro-hint')).animationName,
    recentTransition: getComputedStyle(document.getElementById('homeRecentTrip')).transitionDuration,
    viewport: [innerWidth, innerHeight],
    overflowX: document.documentElement.scrollWidth > innerWidth,
    introRect: (() => {
        const r = document.getElementById('pageIntro')?.getBoundingClientRect();
        return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null;
    })(),
    recentRect: (() => {
        const r = document.getElementById('homeRecentTrip')?.getBoundingClientRect();
        return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null;
    })(),
    dockRect: (() => {
        const r = document.getElementById('footprintContentDock')?.getBoundingClientRect();
        return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null;
    })(),
    ticket: (() => {
        const gallery = document.getElementById('ticketGallery');
        if (!gallery || !gallery.classList.contains('show')) return null;
        const overflowers = [gallery, ...gallery.querySelectorAll('*')]
            .filter(element => element.scrollHeight > element.clientHeight + 1)
            .map(element => ({
                id: element.id || '',
                className: typeof element.className === 'string' ? element.className : '',
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                overflowY: getComputedStyle(element).overflowY
            }))
            .slice(0, 16);
        return {
            clientHeight: gallery.clientHeight,
            scrollHeight: gallery.scrollHeight,
            overflowY: getComputedStyle(gallery).overflowY,
            activeTicket: document.querySelector('.ticket-wallet-item.is-active')?.alt || '',
            title: document.querySelector('.ticket-caption h2')?.textContent.trim() || '',
            boxes: [
                '.ticket-gallery-top',
                '.ticket-gallery-content',
                '.ticket-gallery-view',
                '#ticketStrip',
                '.ticket-strip-scroller',
                '.ticket-caption',
                '.ticket-caption-progress'
            ].map(selector => {
                const element = gallery.querySelector(selector);
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    selector,
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    height: Math.round(rect.height),
                    marginTop: style.marginTop,
                    marginBottom: style.marginBottom,
                    paddingTop: style.paddingTop,
                    paddingBottom: style.paddingBottom,
                    minHeight: style.minHeight
                };
            }).filter(Boolean),
            overflowers
        };
    })(),
    memoryShelf: {
        title: document.getElementById('memoryShelfTitle')?.textContent || '',
        bookMode: document.getElementById('memoryShelf')?.classList.contains('book-mode') || false,
        phase: window.__footprintPhase || '',
        activeBook: document.querySelector('.ms-rail-item.active')?.textContent.trim() || '',
        back: (() => {
            const button = document.getElementById('memoryShelfBack');
            if (!button) return null;
            const closeLabel = button.querySelector('.ms-back-label-close');
            const shelfLabel = button.querySelector('.ms-back-label-shelf');
            return {
                ariaLabel: button.getAttribute('aria-label') || '',
                closeVisible: closeLabel ? getComputedStyle(closeLabel).display !== 'none' : false,
                shelfVisible: shelfLabel ? getComputedStyle(shelfLabel).display !== 'none' : false
            };
        })(),
        frameAction: (() => {
            const action = document.querySelector('.ms-wall-frame-action');
            if (!action) return null;
            const rect = action.getBoundingClientRect();
            return {
                hidden: action.hidden,
                left: action.style.left,
                top: action.style.top,
                width: action.style.width,
                height: action.style.height,
                label: action.getAttribute('aria-label') || '',
                rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)]
            };
        })()
    }
})`);
const state = JSON.parse(stateText);
state.framePoint = framePoint;
state.building = buildingState;

if (process.env.CLICK_RECENT === '1') {
    await evaluate(`document.getElementById('homeRecentTripStart')?.click(); true`);
    await sleep(3000);
}

console.log('页面状态:', state);
if (exceptions.length || consoleErrors.length) {
    const errors = [...exceptions, ...consoleErrors];
    console.error('运行时错误:\n' + errors.join('\n'));
    process.exitCode = 1;
} else {
    console.log('未捕获到前台未处理异常');
}

ws.close();
chrome.kill();
await sleep(500);
try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
} catch {
    // Chromium 退出时偶尔仍占用 Crashpad 文件；临时目录清理失败不影响检测结果。
}
