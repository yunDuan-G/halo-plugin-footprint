/**
 * 2D 高德地图底部工具栏的留言板入口。
 *
 * 显隐与目标地址全部来自后台配置。地址允许站内相对路径或完整 HTTP(S)
 * 地址；关闭开关、留空或协议不安全时，按钮会从视觉、键盘和读屏中一起隐藏。
 */

export function resolveMessageBoardUrl(raw, baseUrl = window.location.href) {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
        const url = new URL(value, baseUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (error) {
        return '';
    }
}

export function setupMessageBoard(config = {}, options = {}) {
    const doc = options.document || document;
    const win = options.window || window;
    const button = doc.getElementById('messageBoards');
    if (!button) return null;

    const enabled = config.enableMessageBoard === true;
    const target = enabled
        ? resolveMessageBoardUrl(config.messageBoardUrl, win.location.href)
        : '';
    const available = !!target;
    button.hidden = !available;
    button.tabIndex = available ? 0 : -1;
    button.setAttribute('aria-hidden', available ? 'false' : 'true');
    if (!available) return { button, target: '', available: false };

    const openBoard = event => {
        if (event) event.preventDefault();
        win.open(target, '_blank', 'noopener,noreferrer');
    };
    button.addEventListener('click', openBoard);
    button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        openBoard(event);
    });
    return { button, target, available: true };
}
