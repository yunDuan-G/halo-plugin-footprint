/**
 * 3D 地球首屏的旅行档案摘要。
 *
 * 左侧标题区显示最近一次旅行，右下方展示同一段旅程的照片与入口。
 * 数据全部来自现有足迹集合，不生成虚构地点、日期或里程。
 */

import { haversineKm } from './footprints-insight.js';

let deps = null;
let latestFootprint = null;
let latestIndex = -1;
let bound = false;
let revealFrame = null;

const introLatest = document.getElementById('introLatest');
const introLatestDate = document.getElementById('introLatestDate');
const introLatestRoute = document.getElementById('introLatestRoute');
const recentTrip = document.getElementById('homeRecentTrip');
const recentTripDate = document.getElementById('homeRecentTripDate');
const recentTripTitle = document.getElementById('homeRecentTripTitle');
const recentTripRoute = document.getElementById('homeRecentTripRoute');
const recentTripMeta = document.getElementById('homeRecentTripMeta');
const recentTripPhotos = document.getElementById('homeRecentTripPhotos');
const recentTripStart = document.getElementById('homeRecentTripStart');

function requestUiFrame(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
        return { type: 'raf', id: window.requestAnimationFrame(callback) };
    }
    return { type: 'timeout', id: window.setTimeout(callback, 16) };
}

function cancelUiFrame(handle) {
    if (!handle) return;
    if (handle.type === 'raf' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle.id);
    } else {
        window.clearTimeout(handle.id);
    }
}

function hideRecentTrip(clearPhotos) {
    if (revealFrame) {
        cancelUiFrame(revealFrame);
        revealFrame = null;
    }
    if (recentTrip) {
        recentTrip.classList.remove('is-visible');
        recentTrip.hidden = true;
    }
    if (clearPhotos && recentTripPhotos) recentTripPhotos.replaceChildren();
}

function revealRecentTrip() {
    if (!recentTrip) return;
    if (revealFrame) {
        cancelUiFrame(revealFrame);
        revealFrame = null;
    }
    // hidden 刚移除时先用基础态占一帧，再挂 is-visible，
    // 这样首次从 display:none 出现也能可靠触发过渡，而不是直接闪现。
    recentTrip.classList.remove('is-visible');
    recentTrip.hidden = false;
    revealFrame = requestUiFrame(() => {
        revealFrame = requestUiFrame(() => {
            revealFrame = null;
            if (!recentTrip.hidden) recentTrip.classList.add('is-visible');
        });
    });
}

function timestampOf(fp) {
    const time = Date.parse(fp && fp.createTime);
    return Number.isFinite(time) ? time : 0;
}

function latestFirst() {
    return deps.footprints()
        .map((fp, index) => ({ fp, index }))
        .sort((a, b) => timestampOf(b.fp) - timestampOf(a.fp));
}

function compactDate(value) {
    const match = String(value || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) return '日期未记录';
    return match[1] + '.' + String(match[2]).padStart(2, '0') +
        '.' + String(match[3]).padStart(2, '0');
}

function placeOf(fp) {
    return [fp.city, fp.province].filter(Boolean).join('，') || fp.address || '未命名地点';
}

function routeAndDistance(latest, previous) {
    const currentCity = latest.city || latest.address || latest.name;
    if (!previous || !previous.city || previous.city === currentCity) {
        return { route: currentCity || '一次新的出发', distance: '' };
    }
    let distance = '';
    if ([latest.lng, latest.lat, previous.lng, previous.lat].every(Number.isFinite)) {
        const km = haversineKm(previous, latest);
        if (km >= 1) distance = '直线约 ' + Math.round(km).toLocaleString('zh-CN') + ' km';
    }
    return {
        route: previous.city + ' → ' + currentCity,
        distance
    };
}

function collectPhotos(entries, latest) {
    const photos = [];
    const seen = new Set();
    const pushPhotos = fp => {
        deps.cityWallImages(fp).forEach(photo => {
            if (!photo || !photo.url || seen.has(photo.url)) return;
            seen.add(photo.url);
            photos.push({
                url: deps.cityCardImageUrl(photo.url),
                alt: photo.caption || ((fp.city || fp.name || '旅行') + '照片')
            });
        });
    };

    pushPhotos(latest);
    entries
        .filter(entry => entry.fp.city && entry.fp.city === latest.city)
        .forEach(entry => pushPhotos(entry.fp));
    entries
        .filter(entry => entry.index !== latestIndex)
        .forEach(entry => pushPhotos(entry.fp));
    return photos.slice(0, 3);
}

function renderPhotos(photos, latest) {
    recentTripPhotos.innerHTML = '';
    photos.forEach((photo, index) => {
        const frame = document.createElement('div');
        frame.className = 'home-recent-photo home-recent-photo-' + (index + 1);
        const image = document.createElement('img');
        image.src = photo.url;
        image.alt = photo.alt;
        image.loading = index === 0 ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => frame.classList.add('is-empty'), { once: true });
        frame.appendChild(image);
        recentTripPhotos.appendChild(frame);
    });

    for (let index = photos.length; index < 3; index++) {
        const frame = document.createElement('div');
        frame.className = 'home-recent-photo is-empty home-recent-photo-' + (index + 1);
        const initial = document.createElement('span');
        initial.textContent = (latest.city || latest.name || '旅').charAt(0);
        frame.appendChild(initial);
        recentTripPhotos.appendChild(frame);
    }
}

function openLatestJourney() {
    if (!latestFootprint) return;
    const key = deps.cityKeyOf(latestFootprint);
    const cities = deps.cityList();
    const cityIndex = cities.findIndex(city => {
        const fp = deps.footprints()[city.indices[0]];
        return fp && deps.cityKeyOf(fp) === key;
    });
    if (cityIndex >= 0) {
        deps.showCityCard(cityIndex, recentTripStart);
        return;
    }
    deps.showMarkerCard(latestFootprint, latestIndex);
}

export function setupHomeStory(d) {
    deps = d;
    if (bound || !recentTripStart) return;
    bound = true;
    recentTripStart.addEventListener('click', openLatestJourney);
}

/** 足迹载入或刷新后，重建首屏的最近旅程摘要。 */
export function refreshHomeStory() {
    if (!deps) return;
    const entries = latestFirst();
    if (!entries.length) {
        latestFootprint = null;
        latestIndex = -1;
        if (introLatest) introLatest.hidden = true;
        hideRecentTrip(true);
        return;
    }

    latestFootprint = entries[0].fp;
    latestIndex = entries[0].index;
    const previous = entries.find(entry =>
        entry.fp.city && entry.fp.city !== latestFootprint.city
    )?.fp || null;
    const date = compactDate(latestFootprint.createTime);
    const { route, distance } = routeAndDistance(latestFootprint, previous);
    const meta = [latestFootprint.footprintType, distance].filter(Boolean).join(' · ');

    if (introLatest) introLatest.hidden = false;
    if (introLatestDate) introLatestDate.textContent = date;
    if (introLatestRoute) introLatestRoute.textContent = route;

    if (deps.showRecentTripCard() === false) {
        hideRecentTrip(true);
        return;
    }

    if (recentTrip && (recentTrip.hidden || !recentTrip.classList.contains('is-visible'))) {
        revealRecentTrip();
    }
    if (recentTripDate) recentTripDate.textContent = date;
    if (recentTripTitle) recentTripTitle.textContent = latestFootprint.name || placeOf(latestFootprint);
    if (recentTripRoute) recentTripRoute.textContent = route;
    if (recentTripMeta) recentTripMeta.textContent = meta || placeOf(latestFootprint);
    if (recentTripPhotos) renderPhotos(collectPhotos(entries, latestFootprint), latestFootprint);
    if (recentTripStart) {
        recentTripStart.setAttribute(
            'aria-label',
            '从最近一次旅程出发，查看' + (latestFootprint.city || latestFootprint.name)
        );
    }
}
