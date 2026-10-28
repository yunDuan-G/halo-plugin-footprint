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
    return result.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: pageUrl });
await sleep(2000);
if (process.env.ENABLE_CITY_FILL === '1') {
    await evaluate(`localStorage.setItem('travelMemoryCityFill', '1'); location.reload(); true`);
}
await sleep(12000);

const state = await evaluate(`JSON.stringify({
    title: document.title,
    body: document.body.className,
    toolbar: document.getElementById('footprintToolbar')?.className || '',
    dock: document.getElementById('footprintContentDock')?.className || '',
    intro: document.getElementById('pageIntro')?.className || '',
    globeChildren: document.getElementById('cesiumContainer')?.children.length || 0
})`);

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
