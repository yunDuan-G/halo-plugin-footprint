/**
 * 留言板后台配置自检：验证启用开关、地址解析、鼠标与键盘打开行为。
 *
 * 用法：node tools/message-board-config-check.mjs
 */
import { JSDOM } from '../ui/node_modules/jsdom/lib/api.js';
import {
    resolveMessageBoardUrl,
    setupMessageBoard
} from '../src/main/frontend/travel-memory/modules/message-board.js';

function createCase(config) {
    const dom = new JSDOM(
        '<div id="messageBoards" role="button" tabindex="0">留言板</div>',
        { url: 'http://localhost:8090/footprints' }
    );
    const opened = [];
    const fakeWindow = {
        location: { href: dom.window.location.href },
        open: (...args) => opened.push(args)
    };
    const result = setupMessageBoard(config, {
        document: dom.window.document,
        window: fakeWindow
    });
    return { dom, opened, result, button: dom.window.document.getElementById('messageBoards') };
}

const enabled = createCase({
    enableMessageBoard: true,
    messageBoardUrl: 'https://example.com/community/messages?from=footprints#latest'
});
if (!enabled.result?.available || enabled.button.hidden) {
    throw new Error('启用留言板时按钮应显示');
}
if (enabled.button.tabIndex !== 0 || enabled.button.getAttribute('aria-hidden') !== 'false') {
    throw new Error('启用留言板时应保留键盘焦点');
}
enabled.button.click();
enabled.button.dispatchEvent(new enabled.dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true
}));
if (enabled.opened.length !== 2 || enabled.opened.some(args =>
    args[0] !== 'https://example.com/community/messages?from=footprints#latest')) {
    throw new Error('鼠标或键盘没有打开后台配置的留言板地址');
}

const relative = createCase({
    enableMessageBoard: true,
    messageBoardUrl: '/message'
});
if (relative.result?.target !== 'http://localhost:8090/message') {
    throw new Error('站内相对地址没有正确解析');
}

const pageAnchor = createCase({
    enableMessageBoard: true,
    messageBoardUrl: '#message-board'
});
if (pageAnchor.result?.target !== 'http://localhost:8090/footprints#message-board') {
    throw new Error('当前页锚点地址没有正确解析');
}

const disabled = createCase({
    enableMessageBoard: false,
    messageBoardUrl: 'https://example.com/messages'
});
if (!disabled.button.hidden || disabled.button.tabIndex !== -1 ||
    disabled.button.getAttribute('aria-hidden') !== 'true') {
    throw new Error('关闭留言板时必须同时移除视觉与键盘入口');
}
disabled.button.click();
if (disabled.opened.length !== 0) {
    throw new Error('关闭留言板后不应再响应点击');
}

const blank = createCase({ enableMessageBoard: true, messageBoardUrl: '  ' });
if (!blank.button.hidden || blank.result?.available) {
    throw new Error('留言板地址为空时应隐藏入口');
}
const missing = createCase({ messageBoardUrl: 'https://example.com/messages' });
if (!missing.button.hidden || missing.result?.available) {
    throw new Error('配置缺失时留言板应默认关闭');
}
if (resolveMessageBoardUrl('javascript:alert(1)', 'https://example.com/')) {
    throw new Error('不安全协议不应生成可打开地址');
}

console.log('留言板配置检查通过：开关、地址、相对路径、键盘与安全协议均正常');
