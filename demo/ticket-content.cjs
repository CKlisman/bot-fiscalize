'use strict';

// Self-contained: executed inside both the authenticated Electron page and Android WebView.
async function captureTicketContent(options = {}) {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = text => String(text || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const escape = text => String(text || '').replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const deadline = Date.now() + (options.timeoutMs || 20000);
    let heading;
    while (Date.now() < deadline) {
        heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,b,span,div,p'))
            .find(el => normalize(el.textContent) === 'descricao do chamado');
        if (heading) break;
        if (document.querySelector('input[type="password"]')) {
            throw new Error('Sessao expirada. Faca login no Fiscalize e gere o PDF novamente.');
        }
        await wait(300);
    }
    if (!heading) throw new Error('O conteudo completo do chamado nao carregou. Tente novamente.');

    // Include siblings (images, replies, attachments), not just the first text paragraph.
    let root = heading.parentElement;
    let candidate = root;
    for (let depth = 0; candidate && candidate !== document.body && depth < 12; depth++) {
        const text = normalize(candidate.textContent);
        if (candidate.querySelector('nav,aside') || text.includes('ordenar menus')) break;
        root = candidate;
        if (Array.from(candidate.querySelectorAll('button,a')).some(el =>
            /atualizar mensagens|retornar atendimento/.test(normalize(el.textContent)))) break;
        const parent = candidate.parentElement;
        if (!parent || parent === document.body) break;
        candidate = parent;
    }

    let changedAt = Date.now();
    const observer = new MutationObserver(() => { changedAt = Date.now(); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    try {
        await wait(600);
        while (Date.now() - changedAt < 600 && Date.now() < deadline) await wait(100);
        if (Date.now() >= deadline) throw new Error('O chamado ainda esta carregando. Tente novamente.');
    } finally { observer.disconnect(); }

    let imageCount = 0;
    let totalBytes = 0;
    const memo = new Map();
    async function imageData(img) {
        const source = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src');
        if (!source) throw new Error('Uma imagem do chamado esta sem endereco. PDF cancelado.');
        const url = new URL(source, document.baseURI);
        if (!['https:', 'http:', 'blob:', 'data:'].includes(url.protocol)) {
            throw new Error('Formato de endereco de imagem nao suportado.');
        }
        if (memo.has(url.href)) return memo.get(url.href);
        let data;
        // Already decoded, same-origin images can be embedded without another request.
        if (img.complete && img.naturalWidth > 0) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                data = canvas.toDataURL('image/png');
            } catch { /* Authenticated fetch also supports cross-origin CORS images. */ }
        }
        if (!data) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(url.href, { credentials: 'include', signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                if (!blob.type.startsWith('image/')) throw new Error('resposta nao e uma imagem');
                if (blob.size > 20 * 1024 * 1024) throw new Error('imagem excede 20 MB');
                data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch {
                throw new Error(`Nao foi possivel carregar a imagem ${imageCount}. Verifique a sessao e tente novamente. PDF cancelado para nao omitir informacoes.`);
            } finally { clearTimeout(timer); }
        }
        await new Promise((resolve, reject) => {
            const decoded = new Image();
            const timer = setTimeout(() => reject(new Error('Tempo limite ao decodificar imagem.')), 10000);
            decoded.onload = () => { clearTimeout(timer); resolve(); };
            decoded.onerror = () => { clearTimeout(timer); reject(new Error('Imagem invalida. PDF cancelado.')); };
            decoded.src = data;
        });
        totalBytes += data.length;
        if (totalBytes > 40 * 1024 * 1024) throw new Error('As imagens excedem 40 MB. PDF cancelado sem cortar conteudo.');
        memo.set(url.href, data);
        return data;
    }

    const allowed = new Set('p div section article h1 h2 h3 h4 h5 h6 strong b em i u s br hr ul ol li table thead tbody tfoot tr th td blockquote pre code span a'.split(' '));
    const excluded = new Set('SCRIPT STYLE BUTTON INPUT SELECT TEXTAREA IFRAME NAV ASIDE FOOTER SVG NOSCRIPT TEMPLATE FORM'.split(' '));
    async function serialize(node) {
        if (node.nodeType === 3) return escape(node.textContent);
        if (node.nodeType !== 1 || excluded.has(node.tagName) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
        if (getComputedStyle(node).display === 'none') return '';
        const tag = node.tagName.toLowerCase();
        if (tag === 'img') {
            imageCount++;
            return `<img src="${escape(await imageData(node))}" alt="${escape(node.alt)}" />`;
        }
        let content = '';
        for (const child of node.childNodes) content += await serialize(child);
        if (!allowed.has(tag)) return content;
        let attrs = '';
        if (tag === 'a') {
            try {
                const url = new URL(node.getAttribute('href'), document.baseURI);
                if (['https:', 'http:', 'mailto:'].includes(url.protocol)) attrs = ` href="${escape(url.href)}"`;
            } catch { /* Keep the attachment label even when its link is invalid. */ }
        }
        if (tag === 'td' || tag === 'th') {
            for (const name of ['colspan', 'rowspan']) {
                const value = Number(node.getAttribute(name));
                if (value > 0 && value < 100) attrs += ` ${name}="${value}"`;
            }
        }
        return `<${tag}${attrs}>${content}${tag === 'br' || tag === 'hr' ? '' : `</${tag}>`}`;
    }
    const contentHtml = await serialize(root);
    return { contentHtml, imageCount, captureVersion: 2 };
}

async function waitForPrintImages() {
    await Promise.all(Array.from(document.images).map(img => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('Tempo limite ao carregar imagem do PDF.')); }, 15000);
        const cleanup = () => { clearTimeout(timer); img.onload = null; img.onerror = null; };
        const done = () => { cleanup(); img.naturalWidth > 0 ? resolve() : reject(new Error('Imagem ausente no PDF.')); };
        img.onload = done;
        img.onerror = () => { cleanup(); reject(new Error('Imagem invalida no PDF.')); };
        if (img.complete) done();
    })));
    if (document.fonts) await document.fonts.ready;
    return document.images.length;
}

module.exports = { captureTicketContent, waitForPrintImages };
