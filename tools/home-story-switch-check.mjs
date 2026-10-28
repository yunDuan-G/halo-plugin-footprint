/**
 * 最近旅程卡后台开关自检：不启动浏览器服务，只验证配置为 true / false 时
 * 右下卡片与左侧摘要各自的显隐行为。
 *
 * 用法：node tools/home-story-switch-check.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from '../ui/node_modules/jsdom/lib/api.js';

const html = readFileSync('src/main/resources/templates/footprint.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/footprints', runScripts: 'outside-only' });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.CustomEvent = window.CustomEvent;

const footprints = [
    {
        name: '外滩散步',
        city: '上海',
        province: '上海',
        createTime: '2026-10-20',
        lng: 121.47,
        lat: 31.23,
        footprintType: '旅游'
    },
    {
        name: '故宫午后',
        city: '北京',
        province: '北京',
        createTime: '2026-09-12',
        lng: 116.40,
        lat: 39.90,
        footprintType: '旅游'
    }
];
const cityList = [
    { city: '上海', indices: [0] },
    { city: '北京', indices: [1] }
];
let showRecentTripCard = false;
let openedCity = -1;

const homeStory = await import('../src/main/frontend/travel-memory/modules/home-story.js');
homeStory.setupHomeStory({
    footprints: () => footprints,
    cityList: () => cityList,
    cityKeyOf: fp => fp.city || '',
    cityWallImages: fp => [{ url: fp.city + '-1.jpg', caption: fp.city + '照片' }],
    cityCardImageUrl: url => url,
    showRecentTripCard: () => showRecentTripCard,
    showCityCard: cityIndex => { openedCity = cityIndex; },
    showMarkerCard: () => {}
});

homeStory.refreshHomeStory();
if (document.getElementById('introLatest').hidden) {
    throw new Error('关闭右下卡片时，左侧最近旅程摘要不应隐藏');
}
if (!document.getElementById('homeRecentTrip').hidden) {
    throw new Error('配置为 false 时，右下最近旅程卡应隐藏');
}
if (document.getElementById('homeRecentTripPhotos').children.length !== 0) {
    throw new Error('关闭卡片时不应创建照片节点');
}

showRecentTripCard = true;
homeStory.refreshHomeStory();
if (document.getElementById('homeRecentTrip').hidden) {
    throw new Error('配置为 true 时，右下最近旅程卡应显示');
}
if (document.getElementById('homeRecentTripPhotos').children.length !== 3) {
    throw new Error('最近旅程卡应渲染三个照片槽位');
}
document.getElementById('homeRecentTripStart').click();
if (openedCity !== 0) {
    throw new Error('最近旅程入口应打开最新足迹所在城市');
}

console.log('最近旅程卡开关通过：关闭仅隐藏右下卡片，开启后照片和入口正常工作');
