/**
 * 票根入口纯 DOM 自检：不启动浏览器。
 *
 * 用法：node tools/ticket-click-dom-check.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from '../ui/node_modules/jsdom/lib/api.js';

const html = readFileSync('src/main/resources/templates/footprint.html', 'utf8');
const dom = new JSDOM(html, {
    url: 'http://localhost/footprints',
    runScripts: 'outside-only'
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Node = window.Node;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true });
Object.defineProperty(globalThis, 'history', { value: window.history, configurable: true });
window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
});
window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

const ticket = await import('../src/main/frontend/travel-memory/modules/ticket-gallery.js');
const noop = () => {};
const emptyElement = () => null;

ticket.setupTicketGallery({
    footprints: () => [],
    cityList: () => [],
    cityKeyOf: () => '',
    viewer: () => ({}),
    reduceMotion: () => true,
    footprintCfg: () => ({}),
    markerCard: emptyElement,
    cityCard: emptyElement,
    cityView: emptyElement,
    cityWall: emptyElement,
    provinceCardsActive: () => false,
    clearProvinceRestorePending: noop,
    hideMarkerCard: noop,
    hideCityCard: noop,
    closeProvinceCards: noop,
    forceGlobeForTickets: noop,
    openCityView: noop,
    openCityWall: noop,
    pauseAutoRotate: noop,
    resumeAutoRotate: noop,
    restoreGlobeViewForAutoRotate: noop,
    setGlobeRenderLoop: noop,
    setOverlayHidden: (el, hidden) => el?.setAttribute('aria-hidden', String(hidden)),
    loadPostcardImage: noop,
    postcardToBlob: noop
});
ticket.initTicketGallery();

const button = document.getElementById('ticketGalleryBtn');
const gallery = document.getElementById('ticketGallery');
if (!button || !gallery) {
    throw new Error('票根按钮或票根容器不存在');
}
// 与主入口 index.js 的绑定保持一致；模块本身不再重复绑定。
button.addEventListener('click', () => ticket.setTicketView(true));
button.click();

if (!gallery.classList.contains('show')) {
    throw new Error('点击票根按钮后，票根容器没有进入 show 状态');
}
if (!document.body.classList.contains('ticket-gallery-open')) {
    throw new Error('点击票根按钮后，body 没有进入 ticket-gallery-open 状态');
}

console.log('票根按钮点击成功：ticketGallery.show = true，ticket-gallery-open = true');
