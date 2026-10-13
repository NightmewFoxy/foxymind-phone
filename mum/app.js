// 妈妈的小帮手 (13 Oct 2026): FoxyMind for the family, in Simplified Chinese (owner: "she only knows how to read
// Mandarin and slightly less English"). A simple page where she talks to Claude about her notes and charts. It
// reaches the computers the same way the owner's phone app does (ntfy topic → tunnel address), with a "family" key
// that only opens /phone/api/family/* (lib/family.js): her own folder, her chats, her files.
// The "能做什么" tab is the heart of it (owner: "letting her know what we can do using Claude, how helpful it can be
// for her on each task"): each task, what it does, an example, and ready-made messages to tap.
// Plain JS, no build step.
(function () {
  'use strict';
  const LS = 'fm-mum';
  let store = {};
  try { store = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { store = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) { /* private mode */ } };
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = $('#app');
  const NTFY = 'https://ntfy.sh';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let toastTimer = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3500); }

  function ago(t) {
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
    const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // ---------- what it can do, and the ready-made messages ----------
  // ____ = the part she fills in (the box selects it, so typing replaces it)
  const STARTERS = [
    { id: 'notes', e: '📝', t: '整理笔记', d: '乱乱的笔记，帮你整理清楚', say: '请帮我整理这些笔记：按内容分类，改正错字，我写的东西一样都不要漏掉，然后存起来。\n\n____' },
    { id: 'photo', e: '📷', t: '拍照变笔记', d: '拍一张纸，帮你打成字', say: '请把这张照片里的字整整齐齐打出来，存成笔记。看不清楚的字请告诉我。', photo: true },
    { id: 'dash', e: '📊', t: '做图表', d: '记账、记血压、记生日', say: '我想做一个图表，用来记录 ____。请一个一个问我想看到什么。' },
    { id: 'todo', e: '✅', t: '待办清单', d: '安排一天、旅行、请客', say: '请帮我做一个 ____ 的待办清单，最要紧的放在最上面。' },
  ];
  const CAPS = [
    { e: '📝', t: '整理笔记', can: ['把乱乱的笔记分类整理，每一样都有清楚的标题', '帮你改错字，把重复的合在一起', '一样都不会漏掉，存在「笔记」里', '以后问它「我写过什么」，它会帮你找出来'],
      ex: ['帮我整理这些笔记：明天买鸡蛋，阿明生日是5月3号，鸡蛋要两盒，医生说下个月复诊…', '分好类的笔记：「买菜清单」「家人生日」「看医生」，各自一份。'],
      tries: [
        { t: '整理我的笔记', say: '请帮我整理这些笔记：按内容分类，改正错字，我写的东西一样都不要漏掉，然后存起来。\n\n____' },
        { t: '加进我已有的笔记', say: '请把这些加进我关于 ____ 的笔记里：\n\n____' },
        { t: '在笔记里找东西', say: '帮我看看我的笔记里，关于 ____ 我写了什么？' },
        { t: '把所有笔记整理一遍', say: '请把我所有的笔记看一遍，一样的合在一起，每一份都给一个清楚的标题。什么都不要删掉。' },
      ] },
    { e: '📷', t: '拍照变笔记', can: ['手写的字、收据、药单、学校通知，拍一张照片就可以', '它会把字打出来，整整齐齐存好', '收据可以帮你算总数、记进开销'],
      ex: ['（拍一张手写的食谱）请帮我打成字。', '一份打好字的食谱笔记：材料、份量、步骤，清清楚楚。'],
      tries: [
        { t: '把照片打成字', say: '请把这张照片里的字整整齐齐打出来，存成笔记。看不清楚的字请告诉我。', photo: true },
        { t: '收据记账', say: '这是我的收据，请帮我记下买了什么、多少钱，加进我的开销记录。', photo: true },
      ] },
    { e: '📊', t: '图表和记录', can: ['每月开销：每一类花了多少，一个圆饼图一看就懂', '血压、血糖、体重：每天记一下，看到变化的曲线', '家人生日和重要日子：下一个是什么，一目了然', '你可以自己在页面上加新的数字'],
      ex: ['我想记每个月的开销：菜钱、水电、交通、给孩子、其他。', '一个「每月开销」图表：每类多少钱、总数、圆饼图，你可以自己加新的开销。'],
      tries: [
        { t: '每月开销', say: '请帮我做一个每月开销的图表。分类：菜钱、水电费、交通、家人、其他。我要看到这个月的总数和一个圆饼图，我自己可以在页面上加新的开销。' },
        { t: '健康记录（血压、血糖）', say: '请帮我做一个记录 ____（例如血压或血糖）的图表，每天可以写下日期和数字，看到一条变化的曲线。' },
        { t: '家人生日和重要日子', say: '请帮我做一个家人生日和重要日子的图表，最近的排在最前面。日子如下：\n\n____' },
        { t: '更新图表的数字', say: '请把我 ____ 的图表更新，新的数字是：\n\n____' },
        { t: '把笔记变成图表', say: '请把我关于 ____ 的笔记做成一个图表。' },
      ] },
    { e: '✅', t: '计划和清单', can: ['待办清单：最要紧的放最前面', '旅行、请客、过年要准备什么，一样一样列出来', '帮你安排一个星期'],
      ex: ['下个星期六家里请客，十个人。', '一份清单：要买什么、什么时候做、哪一样先准备。'],
      tries: [
        { t: '待办清单', say: '请帮我做一个 ____ 的待办清单，最要紧的放在最上面。' },
        { t: '安排我的一个星期', say: '请帮我安排这个星期。我要做的事情有：\n\n____' },
        { t: '请客要准备什么', say: '我 ____ 要在家里请客，大约 ____ 个人。请帮我列出要准备的东西和时间。' },
      ] },
    { e: '🍲', t: '煮饭和食谱', can: ['写一份清楚的食谱：材料、份量、步骤', '按人数调份量', '从食谱变出买菜清单'],
      ex: ['咖喱鸡，六个人吃。', '六人份的咖喱鸡食谱，加一份按菜市场分好的买菜清单。'],
      tries: [
        { t: '写一份食谱', say: '请帮我写一份 ____ 的食谱：材料和份量，然后一步一步的做法，简单清楚。' },
        { t: '买菜清单', say: '我要煮 ____ 给 ____ 个人吃，请帮我列一份买菜清单。' },
      ] },
    { e: '✉️', t: '帮你写信息、看懂英文', can: ['帮你写有礼貌的短信', '看不懂的英文或马来文信件、通知，帮你翻成中文、讲重点', '把你的中文翻成英文或马来文'],
      ex: ['（拍一张英文的银行信）这封信说什么？我要做什么吗？', '用简单的中文说明信的重点，还有你要不要做什么。'],
      tries: [
        { t: '看不懂这封信', say: '这封信是什么意思？请用简单的中文告诉我重点，还有我需要做什么。', photo: true },
        { t: '翻译一段话', say: '请把这段话翻译成 ____：\n\n____' },
        { t: '帮我写信息', say: '请帮我写一段简短有礼貌的信息给 ____，内容是 ____。' },
      ] },
    { e: '💡', t: '解释和学习', can: ['用简单的话解释你不懂的东西，还有例子', '手机或电脑怎么用，一步一步教你', '任何好奇的问题都可以问'],
      ex: ['什么是电子钱包？安全吗？', '用简单的中文解释，再说要注意什么。'],
      tries: [
        { t: '简单解释给我听', say: '请用简单的中文解释 ____ 是什么，再给我一个例子。' },
        { t: '教我用手机做一件事', say: '请一步一步教我在手机上 ____。' },
      ] },
  ];
  const tryById = {}; // (a "试试看" button's message, by an id in its data attribute)
  CAPS.forEach((c, i) => c.tries.forEach((t, j) => { tryById[`${i}-${j}`] = t; }));

  // ---------- finding the computer + API (as the owner's phone app: phone/www/app.js) ----------
  store.bases = store.bases || {};
  const conn = { state: 'unknown', pickedAt: 0, lastDiscover: 0 };
  async function discover() {
    if (store.devBase) return store.devBase;
    if (!store.topic) throw new Error('not set up');
    conn.lastDiscover = Date.now();
    const r = await fetch(`${NTFY}/${encodeURIComponent(store.topic)}/json?poll=1&since=24h`, { cache: 'no-store' });
    if (!r.ok) throw new Error('lookup failed');
    const found = {};
    for (const line of (await r.text()).split('\n')) {
      try {
        const o = JSON.parse(line);
        if (!o || o.event !== 'message' || typeof o.message !== 'string') continue;
        if (o.message.startsWith('url: ')) found.mac = o.message.slice(5).trim().replace(/\/+$/, '');
        else if (o.message.startsWith('win: ')) found.pc = o.message.slice(5).trim().replace(/\/+$/, '');
      } catch (e) { /* skip */ }
    }
    if (!found.mac && !found.pc) throw new Error('no address yet');
    store.bases = Object.assign({}, store.bases, found); save();
    return store.bases.mac || store.bases.pc;
  }
  async function ping(base) {
    if (!base) return false;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`${base}/phone/api/ping`, { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      clearTimeout(t); const j = await r.json(); return !!(r.ok && j && j.ok);
    } catch (e) { return false; }
  }
  let picking = null;
  function pickRoute() {
    if (store.devBase) return Promise.resolve(store.devBase);
    if (picking) return picking;
    if (conn.pickedAt && Date.now() - conn.pickedAt < 4000) return Promise.resolve(store.route ? store.bases[store.route] : null);
    picking = (async () => {
      if (store.topic && Date.now() - conn.lastDiscover > 15000) { try { await discover(); } catch (e) { /* keep */ } }
      const [mac, pc] = await Promise.all([ping(store.bases.mac), ping(store.bases.pc)]);
      const r = mac ? 'mac' : pc ? 'pc' : null;
      conn.pickedAt = Date.now();
      if (r && r !== store.route) { store.route = r; save(); }
      return r ? store.bases[r] : null;
    })().finally(() => { picking = null; });
    return picking;
  }
  const currentBase = () => store.devBase || (store.route && store.bases[store.route]) || store.bases.mac || store.bases.pc || null;
  class ApiError extends Error { constructor(m, status, offline) { super(m); this.status = status; this.offline = !!offline; } }
  function setConn(s) { if (conn.state === s) return; conn.state = s; $$('.offline-slot').forEach(paintOffline); }
  function paintOffline(el) { el.innerHTML = conn.state === 'offline' ? '<div class="banner">小帮手的电脑现在睡着了或没有网络。等电脑好了，这里会自己恢复，不用做什么。</div>' : ''; }
  // (the server's words are English: she gets Chinese ones)
  const CN = { 404: '这个对话已经关了，请回首页再打开。', 403: '这个不能在这里打开。', 429: '请等一分钟再试。' };

  async function api(method, path, body, opts = {}) {
    let base = currentBase();
    if (!base) { try { base = (await pickRoute()) || (await discover()); } catch (e) { setConn('offline'); throw new ApiError('连不上电脑', 0, true); } }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = null; let data = null; let bad = false; let late = false;
      try {
        const headers = {};
        if (opts.raw) headers['Content-Type'] = opts.type || 'application/octet-stream';
        else if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (opts.auth !== false && store.token) headers.Authorization = `Bearer ${store.token}`;
        const ctl = new AbortController(); const t = setTimeout(() => { late = true; ctl.abort(); }, opts.timeout || 20000);
        res = await fetch(`${base}/phone/api${path}`, { method, headers, mode: 'cors', cache: 'no-store', credentials: 'omit', body: opts.raw ? opts.raw : body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal });
        clearTimeout(t);
        if (opts.blob && res.ok) { setConn('online'); return await res.blob(); }
        const text = await res.text();
        try { data = text ? JSON.parse(text) : {}; } catch (e) { bad = true; }
        if ([502, 503, 504, 520, 521, 522, 523, 524, 530].includes(res.status)) bad = true;
        if (res.status === 401 && base === store.bases.pc && base !== store.bases.mac) bad = true; // (Windows may not know her yet)
      } catch (e) { bad = true; }
      if (!bad) {
        setConn('online');
        if (res.status === 401 && opts.auth !== false) { delete store.token; save(); route(); throw new ApiError('这个设备已经断开了，请向家人要一个新的链接。', 401); }
        if (!res.ok) throw new ApiError(CN[res.status] || '出了一点问题，请再试一次。', res.status);
        return data;
      }
      if (attempt > 0 || (method !== 'GET' && late)) break;
      const nb = await pickRoute();
      if (!nb) break;
      base = nb;
    }
    setConn('offline');
    throw new ApiError('现在连不上电脑', 0, true);
  }

  // ---------- polling helper ----------
  let loops = [];
  function loop(fn, ms) {
    let stop = false; let timer = null;
    const tick = async () => { timer = null; if (stop) return; if (!document.hidden) { try { await fn(); } catch (e) { /* shown by the banner */ } } if (!stop) timer = setTimeout(tick, typeof ms === 'function' ? ms() : ms); };
    tick();
    const l = { stop() { stop = true; clearTimeout(timer); }, kick() { if (!stop && timer) { clearTimeout(timer); tick(); } } };
    loops.push(l); return l;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loops.forEach((l) => l.kick()); });

  // ---------- router ----------
  let cleanup = null;
  function show(html, after) {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    loops.forEach((l) => l.stop()); loops = [];
    app.innerHTML = html;
    $$('.offline-slot').forEach(paintOffline);
    window.scrollTo(0, 0);
    if (after) cleanup = after() || null;
  }
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  function tabs(on) {
    const t = (id, href, e, label) => `<a href="${href}" class="${on === id ? 'on' : ''}"><span class="e">${e}</span>${label}</a>`;
    return `<nav class="tabs"><div class="in">${t('home', '#/', '🏠', '首页')}${t('can', '#/can', '💡', '能做什么')}${t('notes', '#/notes', '📒', '笔记')}${t('dash', '#/dash', '📊', '图表')}</div></nav>`;
  }
  function route() {
    const h = location.hash || '#/';
    if (h.startsWith('#pair=')) return PairView(decodeURIComponent(h.slice(6)));
    if (!store.token) return PairView(null);
    let m;
    if ((m = h.match(/^#\/c\/(.+)$/))) return ChatView(decodeURIComponent(m[1]));
    if ((m = h.match(/^#\/new\/([a-z]+)$/))) return ChatView(null, m[1]);
    if ((m = h.match(/^#\/f\/(.+)$/))) return FileView(decodeURIComponent(m[1]));
    if (h === '#/notes') return FilesView('notes');
    if (h === '#/dash') return FilesView('dash');
    if (h === '#/can') return CanView();
    if (!store.welcomed) return WelcomeView();
    return HomeView();
  }
  window.addEventListener('hashchange', route);
  // a ready-made message opens a new chat with it filled in
  function startWith(msg, photo) { store['draft:new'] = msg; store['draft:newphoto'] = !!photo; save(); go('#/new/ready'); }

  // ======================================================================================
  // Setting up (the link her son sends her, or a 6-letter code)
  // ======================================================================================
  function parsePair(raw) {
    const m = String(raw || '').match(/(fm-phone-[0-9a-f]{24})\.([0-9a-f]{32})/i);
    return m ? { topic: m[1], code: m[2] } : null;
  }
  const deviceName = () => `Mum's ${isIOS ? 'iPhone' : /Android/i.test(navigator.userAgent) ? 'phone' : 'computer'}`;
  async function pairWith(topic, code) {
    store.topic = topic; store.bases = {}; delete store.route; save();
    try { await discover(); } catch (e) { throw new Error('找不到电脑。电脑开着吗？'); }
    await pickRoute();
    let r;
    try { r = await api('POST', '/pair', { code, name: deviceName() }, { auth: false }); } catch (e) {
      if (e.offline) throw new Error('连不上电脑。电脑开着吗？');
      throw new Error('这个链接已经用过了，或者太旧了。请向家人要一个新的。');
    }
    if (!r || !r.token) throw new Error('出了点问题，请向家人要一个新的链接。');
    store.token = r.token; store.pairedAt = Date.now(); save();
  }
  async function pairCode(raw) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-HJKMNP-Z2-9]{6}$/.test(code)) throw new Error('号码是 6 个英文字母和数字。');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`foxymind-pair:${code}`));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    let topic = null;
    for (let i = 0; !topic && i < 3; i++) {
      if (i) await sleep(2500);
      try {
        const r = await fetch(`${NTFY}/fm-pair-${hex.slice(0, 32)}/json?poll=1&since=1h`, { cache: 'no-store' });
        for (const line of (await r.text()).split('\n')) { try { const o = JSON.parse(line); const m = o && o.event === 'message' && /^topic: (fm-phone-[0-9a-f]{24})$/.exec(String(o.message || '').trim()); if (m) topic = m[1]; } catch (e) { /* skip */ } }
      } catch (e) { /* try again */ }
    }
    if (!topic) throw new Error('这个号码不对，或者已经超过 15 分钟了。');
    return pairWith(topic, code);
  }
  function PairView(raw) {
    const p = raw ? parsePair(raw) : null;
    show(`<div class="main"><div class="hero"><div class="e">🌷</div><h1>妈妈的小帮手</h1><p class="lead">帮你整理笔记、做图表、回答问题。</p></div>
      <div class="card" id="pairbox">${p ? '<p><span class="spin"></span> 正在准备，请等一下…</p>' : `<p>请输入家人发给你的 6 位号码：</p>
      <input class="codebox" maxlength="7" placeholder="ABC234" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="号码">
      <button class="btn block" data-act="code">开始</button>`}</div><p class="lead" id="pairmsg"></p></div>`, () => {
      const msg = $('#pairmsg');
      const done = () => { history.replaceState(null, '', location.pathname + location.search + '#/'); toast('准备好了！🌷'); route(); };
      if (p) {
        if (store.token && store.pairedWith === `${p.topic}.${p.code}`) { done(); return; }
        pairWith(p.topic, p.code).then(() => { store.pairedWith = `${p.topic}.${p.code}`; save(); done(); }).catch((e) => {
          $('#pairbox').innerHTML = `<p>${esc(e.message)}</p>`;
        });
        return;
      }
      const btn = $('[data-act="code"]'); const box = $('.codebox');
      const run = () => { btn.disabled = true; msg.textContent = '正在检查…'; pairCode(box.value).then(done).catch((e) => { msg.textContent = e.message; btn.disabled = false; }); };
      btn.onclick = run; box.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    });
  }

  // ======================================================================================
  // The first time: a few simple pages, then Home
  // ======================================================================================
  const TOUR = [
    { e: '🌷', t: '欢迎！', p: '这是你自己的小帮手。你像发短信一样写给它，它就帮你做事。' },
    { e: '📝', t: '帮你记笔记', p: '乱乱的笔记，或者手写的纸拍一张照片，它都会帮你整整齐齐写好，放在下面的<b>「笔记」</b>里。' },
    { e: '📊', t: '帮你做图表', p: '记账、记血压、记家人生日，它都可以做成图表，放在<b>「图表」</b>里。' },
    { e: '👍', t: '不用怕弄坏', p: '随便按，随便问。不知道说什么的时候，看看<b>「能做什么」</b>，按一下就可以用现成的话。' },
  ];
  function WelcomeView(i = 0) {
    const s = TOUR[i]; const lastOne = i === TOUR.length - 1;
    show(`<div class="main"><div class="hero"><div class="e">${s.e}</div><h1>${s.t}</h1><p class="lead" style="font-size:21px">${s.p}</p></div>
      <p style="text-align:center;color:var(--soft)">${TOUR.map((_, j) => (j === i ? '●' : '○')).join(' ')}</p>
      <button class="btn block" data-act="next" style="font-size:21px;min-height:60px">${lastOne ? '开始用' : '下一页'}</button></div>`, () => {
      $('[data-act="next"]').onclick = () => { if (lastOne) { store.welcomed = Date.now(); save(); route(); } else WelcomeView(i + 1); };
    });
  }

  // ======================================================================================
  // Home: the starters and her chats
  // ======================================================================================
  let lastChats = store.lastChats || null;
  function HomeView() {
    const hour = new Date().getHours();
    const hi = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
    show(`<header class="top"><h1>${hi} 🌷</h1></header>
      <div class="main"><div class="offline-slot"></div>
      <p class="lead">今天想做什么？按一个就可以开始。</p>
      <div class="starters">${STARTERS.map((s) => `<button class="starter" data-s="${s.id}"><span class="e">${s.e}</span><b>${esc(s.t)}</b><span>${esc(s.d)}</span></button>`).join('')}
        <button class="starter wide" data-s="free"><span class="e">💬</span><div><b>随便问</b><br><span>什么都可以问它</span></div></button></div>
      <button class="seeall" data-act="can"><span class="e">💡</span><span><b>小帮手还能做什么？</b><span>看看它可以怎样帮你，还有现成的话可以直接用</span></span></button>
      <div class="sect">我的对话</div><div id="chats"></div></div>${tabs('home')}`, () => {
      $$('[data-s]').forEach((b) => { b.onclick = () => go(`#/new/${b.dataset.s}`); });
      $('[data-act="can"]').onclick = () => go('#/can');
      const paint = () => {
        const el = $('#chats'); if (!el) return;
        if (!lastChats) { el.innerHTML = '<div class="empty"><span class="spin"></span></div>'; return; }
        const open = lastChats.chats || []; const past = lastChats.past || [];
        if (!open.length && !past.length) { el.innerHTML = '<div class="empty">还没有对话。按上面的按钮开始吧。</div>'; return; }
        const word = { working: '正在做…', waiting: '回复了', resting: '休息中（你写信息它就醒来）', ended: '结束了', ready: '可以用了' };
        el.innerHTML = `<div class="list">${open.map((c) => `<button class="row" data-c="${esc(c.id)}"><span class="dot ${c.state}"></span><span class="tx"><b>${esc(c.title === 'New chat' ? '新对话' : c.title)}</b><small>${c.asking ? '有问题要问你' : word[c.state] || ''}${c.lastOutputAt ? ` · ${ago(c.lastOutputAt)}` : ''}</small></span><span class="go">›</span></button>`).join('')}
          ${past.slice(0, 15).map((c) => `<button class="row" data-p="${esc(c.chatId)}"><span class="ic">🗂️</span><span class="tx"><b>${esc(String(c.title).slice(0, 80))}</b><small>以前的对话${c.mtime ? ` · ${ago(c.mtime)}` : ''}</small></span><span class="go">›</span></button>`).join('')}</div>`;
        $$('[data-c]', el).forEach((b) => { b.onclick = () => go(`#/c/${encodeURIComponent(b.dataset.c)}`); });
        $$('[data-p]', el).forEach((b) => { b.onclick = async () => { b.disabled = true; try { const r = await api('POST', '/family/chats/resume', { chatId: b.dataset.p }, { timeout: 60000 }); go(`#/c/${encodeURIComponent(r.id)}`); } catch (e) { toast(e.message); b.disabled = false; } }; });
      };
      paint();
      loop(async () => { const r = await api('GET', '/family/chats'); lastChats = r; store.lastChats = r; save(); paint(); }, 5000);
    });
  }

  // ======================================================================================
  // A chat
  // ======================================================================================
  function parseQuestion(text) { // (as phone/www/app.js: Claude's numbered on-screen choices)
    const lines = String(text || '').split('\n').map((l) => l.replace(/[│╭╮╰╯┌┐└┘]/g, ' ').replace(/\s+$/, ''));
    const OPT = /^(\s*)([❯>›→]?)\s*(\d)\.\s+(\S.*)$/;
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (OPT.test(lines[i])) { last = i; break; }
    if (last < 0) return null;
    let first = -1;
    for (let i = last; i >= Math.max(0, last - 40); i--) { const m = OPT.exec(lines[i]); if (m && m[3] === '1') { first = i; break; } }
    if (first < 0) return null;
    const options = []; let cur = null;
    const isFooter = (t) => /Enter to (select|confirm)|Esc to (cancel|go back)|↑\/↓|Tab to/i.test(t);
    for (let i = first; i < lines.length; i++) {
      const t = lines[i].trim(); const m = OPT.exec(lines[i]);
      if (m && Number(m[3]) === options.length + 1) { cur = { n: m[3], label: m[4].replace(/\s*\((esc|y|n)\)\s*$/i, '').trim(), desc: '' }; options.push(cur); continue; }
      if (i > last && (!t || isFooter(t))) break;
      if (!t || /^[─━—-]{3,}$/.test(t) || isFooter(t)) continue;
      if (cur) cur.desc += (cur.desc ? ' ' : '') + t;
    }
    if (options.length < 2) return null;
    let q = '';
    for (let i = first - 1; i >= Math.max(0, first - 12); i--) { const t = lines[i].trim(); if (/^[─━—-]{3,}$/.test(t) || /^[●⏺✻]/.test(t)) break; if (t) { q = t.replace(/^[›☐❯]\s*/, ''); if (/[?？]\s*$/.test(q)) break; } }
    // (Claude Code's own permission questions are in English: say them in Chinese)
    const perm = /^Do you want to|^Allow|proceed\?|make this edit|create /i.test(q);
    const cn = (l) => (/^Yes$/i.test(l) ? '好的' : /^Yes, (and )?(allow|don.t ask)/i.test(l) ? '好的，以后不用再问' : /^No\b/i.test(l) ? '不要' : l);
    return { question: perm ? '小帮手想做一件事，可以吗？' : q || '请选一个：', options: options.filter((o) => !/^(type something|chat about this)/i.test(o.label)).map((o) => ({ ...o, label: cn(o.label), desc: perm ? '' : o.desc })) };
  }
  const STEP = { Write: '📝 存好了', Edit: '📝 改好了', MultiEdit: '📝 改好了', Read: '📖 正在看', WebSearch: '🔎 上网查一查', WebFetch: '🌐 正在看网页', Glob: '🗂️ 找一找你的东西', Grep: '🗂️ 找一找你的东西', TodoWrite: '🗒️ 想一想步骤' };
  function renderMsg(m) {
    if (m.role === 'user') {
      // (a chat that got long goes on in a fresh one, which starts with the gist of the old one: shown as a note)
      const carried = /^<接上次的对话>[\s\S]*?<\/接上次的对话>\s*/.exec(m.text);
      const t = carried ? m.text.slice(carried[0].length) : m.text;
      return `${carried ? '<div class="carried">📒 上一个对话太长了，小帮手换了一页继续。之前说的话它都记得。</div>' : ''}${t.trim() ? `<div class="msg me">${esc(t.replace(/\[(\d+) images?\]/, '[$1 张照片]'))}</div>` : ''}`;
    }
    if (m.role === 'system') return '';
    let html = ''; let step = '';
    for (const p of m.parts || []) {
      if (p.type === 'text') { if (step) { html += `<p class="step">${esc(step)}</p>`; step = ''; } html += window.md ? window.md.render(p.text) : `<p>${esc(p.text)}</p>`; }
      else if (p.type === 'tool' && p.name !== 'AskUserQuestion') step = STEP[p.name] || '⚙️ 正在做';
    }
    if (step) html += `<p class="step">${esc(step)}</p>`;
    return html ? `<div class="msg them">${html}</div>` : '';
  }
  // ≤2048 px JPEG (a phone photo is 3-5 MB). A photo this browser can't open (a Samsung's HEIC, owner 13 Oct 2026:
  // it showed broken and nothing sent) goes as it is: the computer makes it a JPEG (lib/family.js toJpeg).
  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* try an <img> */ }
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async function shrink(file) {
    try {
      const bmp = await decode(file);
      const w = bmp.width || bmp.naturalWidth; const h = bmp.height || bmp.naturalHeight;
      const k = Math.min(1, 2048 / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
      if (b && b.size > 0) return { blob: b, seen: true };
    } catch (e) { /* as it is */ }
    return { blob: file, seen: false };
  }
  function ChatView(id, starter) {
    let s = STARTERS.find((x) => x.id === starter);
    if (starter === 'ready') s = { t: '新对话', say: store['draft:new'] || '', photo: !!store['draft:newphoto'] };
    const draftKey = id ? `draft:${id}` : null;
    show(`<header class="top line"><button class="back" data-act="back" aria-label="返回">‹</button><h2 id="ctitle">${s ? esc(s.t) : id ? '对话' : '新对话'}</h2></header>
      <div class="offline-slot" style="padding:0 14px"></div>
      <div class="chat" id="msgs">${id ? '<div class="empty"><span class="spin"></span></div>' : `<div class="msg them"><p>你好！🌷 ${s && s.say ? '我已经帮你在下面写好了一段话。<b>____</b> 的地方请换成你自己的话，然后按 <b>➤</b> 发送。' : '在下面写你要的东西，然后按 <b>➤</b> 发送。也可以按 📷 加照片。'}</p></div>`}</div>
      <div class="composer"><div class="thumbs" id="thumbs"></div><div class="bar">
        <button class="iconbtn" data-act="photo" aria-label="加照片">📷</button>
        <textarea id="box" rows="1" placeholder="在这里写…" aria-label="你的信息"></textarea>
        <button class="sendbtn" data-act="send" aria-label="发送">➤</button></div>
        <input type="file" id="pick" accept="image/*" multiple hidden></div>`, () => {
      let chatId = id; let known = null; let msgs = []; let pending = []; let state = 'ready'; let ask = null; let busy = false;
      const photos = []; // { blob, url }
      const box = $('#box'); const list = $('#msgs');
      const grow = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, window.innerHeight * 0.4)}px`; };
      box.oninput = () => { grow(); if (draftKey) { store[draftKey] = box.value; save(); } };
      if (s && s.say) {
        box.value = s.say; grow();
        const at = box.value.indexOf('____');
        setTimeout(() => { box.focus(); if (at >= 0) box.setSelectionRange(at, at + 4); else box.setSelectionRange(box.value.length, box.value.length); }, 150);
      } else if (draftKey && store[draftKey]) { box.value = store[draftKey]; grow(); }
      const nearBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
      const paint = (stick) => {
        const userCount = msgs.filter((m) => m.role === 'user').length;
        pending = pending.filter((p) => userCount <= p.base);
        let html = msgs.map(renderMsg).join('') + pending.map((p) => `<div class="msg me pending">${esc(p.text)}</div>`).join('');
        if (ask) html += `<div class="ask"><p class="q">${esc(ask.question)}</p><div class="opts">${ask.options.map((o) => `<button class="opt" data-n="${o.n}">${esc(o.label)}${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</button>`).join('')}</div></div>`;
        else if (state === 'working' || pending.length) html += '<div class="thinking"><i></i><i></i><i></i><span>正在做，请等一下…</span></div>';
        if (!html) html = '<div class="empty">打个招呼开始吧。</div>';
        const stickNow = stick || nearBottom();
        list.innerHTML = html;
        $$('.opt', list).forEach((b) => { b.onclick = async () => { $$('.opt', list).forEach((x) => { x.disabled = true; }); try { await api('POST', `/family/chats/${encodeURIComponent(chatId)}/key`, { key: b.dataset.n }); ask = null; state = 'working'; paint(true); setTimeout(() => poller && poller.kick(), 800); } catch (e) { toast(e.message); $$('.opt', list).forEach((x) => { x.disabled = false; }); } }; });
        if (stickNow) window.scrollTo(0, document.body.scrollHeight);
      };
      let poller = null;
      const fetchChat = async () => {
        if (!chatId) return;
        let r;
        try { r = await api('GET', `/family/chats/${encodeURIComponent(chatId)}?limit=80${known != null ? `&known=${known}` : ''}`); } catch (e) {
          if (e.status === 404) { toast('这个对话已经关了，回到首页。'); go('#/'); }
          throw e;
        }
        const first = known == null;
        if (!r.unchanged) { msgs = r.messages || []; known = r.size; }
        state = r.state || 'ready';
        ask = r.asking && r.screen ? parseQuestion(r.screen) : null;
        if (r.title && r.title !== 'New chat') $('#ctitle').textContent = r.title;
        paint(first);
      };
      const startPolling = () => { if (!poller) poller = loop(fetchChat, () => (state === 'working' || pending.length ? 2000 : 4000)); };
      if (chatId) startPolling();
      $('[data-act="back"]').onclick = () => go('#/');
      const pick = $('#pick');
      $('[data-act="photo"]').onclick = () => pick.click();
      // (a photo this phone can't show gets a plain tile instead of a broken picture; a red one couldn't be sent)
      const paintThumbs = () => {
        $('#thumbs').innerHTML = photos.map((p, i) => `<div class="${p.bad ? 'bad' : ''}">${p.seen ? `<img src="${p.url}" alt="照片 ${i + 1}">` : `<span class="tile">🖼️<small>照片 ${i + 1}</small></span>`}<button data-rm="${i}" aria-label="拿掉照片 ${i + 1}">✕</button></div>`).join('');
        $$('[data-rm]').forEach((b) => { b.onclick = () => { const [p] = photos.splice(Number(b.dataset.rm), 1); if (p.url) URL.revokeObjectURL(p.url); paintThumbs(); }; });
      };
      pick.onchange = async () => {
        const files = Array.from(pick.files || []); pick.value = '';
        if (photos.length + files.length > 10) toast('一次最多10张照片。');
        for (const f of files.slice(0, Math.max(0, 10 - photos.length))) { const r = await shrink(f); photos.push({ blob: r.blob, seen: r.seen, url: r.seen ? URL.createObjectURL(r.blob) : null }); }
        paintThumbs();
      };
      if (s && s.photo) setTimeout(() => pick.click(), 300);
      const send = async () => {
        const text = box.value.replace(/____/g, '').trim();
        if (busy || (!text && !photos.length)) { if (!busy) toast('请先写点东西 🙂'); return; }
        busy = true; const btn = $('[data-act="send"]'); btn.disabled = true;
        try {
          if (!chatId) {
            const r = await api('POST', '/family/chats/new', { text, photo: photos.length > 0 }, { timeout: 60000 });
            chatId = r.id; history.replaceState(null, '', `#/c/${encodeURIComponent(chatId)}`);
            if (starter === 'ready') { delete store['draft:new']; delete store['draft:newphoto']; save(); }
          }
          const ids = [];
          for (const [i, p] of photos.entries()) {
            if (p.id && p.chat === chatId) { ids.push(p.id); continue; } // (went up on an earlier try)
            try {
              const r = await api('POST', `/family/chats/${encodeURIComponent(chatId)}/photo`, undefined, { raw: p.blob, type: /^image\/(jpeg|png|gif|webp)$/.test(p.blob.type) ? p.blob.type : (p.blob.type || 'application/octet-stream'), timeout: 180000 });
              p.id = r.photoId; p.chat = chatId; p.bad = false; ids.push(r.photoId);
            } catch (e) {
              if (e.offline) throw e;
              p.bad = true; paintThumbs();
              throw new Error(e.status === 413 ? `第${i + 1}张照片太大了，请按它上面的 ✕ 拿掉，再按 ➤ 发送。` : `第${i + 1}张照片打不开（红色那张），请按它上面的 ✕ 拿掉，再按 ➤ 发送。`);
            }
          }
          const sent = await api('POST', `/family/chats/${encodeURIComponent(chatId)}/send`, { text: text || '这是照片。', photos: ids }, { timeout: 60000 });
          if (sent && sent.movedTo) { chatId = sent.movedTo; history.replaceState(null, '', `#/c/${encodeURIComponent(chatId)}`); msgs = []; known = null; }
          pending.push({ text: (text || '') + (ids.length ? `${text ? '\n' : ''}[${ids.length} 张照片]` : ''), base: msgs.filter((m) => m.role === 'user').length });
          photos.splice(0).forEach((p) => URL.revokeObjectURL(p.url)); paintThumbs();
          box.value = ''; grow(); if (draftKey) { delete store[draftKey]; save(); }
          state = 'working'; paint(true); startPolling(); setTimeout(() => poller && poller.kick(), 1500);
        } catch (e) { toast(e.offline ? '现在连不上电脑。你写的话还在框里，等一下再按发送。' : e.message); }
        busy = false; btn.disabled = false;
      };
      $('[data-act="send"]').onclick = send;
      return () => { photos.forEach((p) => URL.revokeObjectURL(p.url)); };
    });
  }

  // ======================================================================================
  // Notes and charts (the files in her space)
  // ======================================================================================
  let lastFiles = store.lastFiles || null;
  function FilesView(which) {
    const dash = which === 'dash';
    show(`<header class="top"><h1>${dash ? '图表' : '笔记'}</h1></header><div class="main"><div class="offline-slot"></div>
      <p class="lead">${dash ? '小帮手帮你做的图表和记录。按一个打开。' : '小帮手帮你写下来的东西，最新的在最上面。按一个打开。'}</p>
      <div id="files"></div>
      <div class="fileacts"><button class="btn" data-act="new">${dash ? '📊 做一个新图表' : '📝 加新的笔记'}</button></div></div>${tabs(dash ? 'dash' : 'notes')}`, () => {
      $('[data-act="new"]').onclick = () => go(`#/new/${dash ? 'dash' : 'notes'}`);
      const paint = () => {
        const el = $('#files'); if (!el) return;
        if (!lastFiles) { el.innerHTML = '<div class="empty"><span class="spin"></span></div>'; return; }
        const fs = (lastFiles.files || []).filter((f) => (dash ? f.kind === 'dashboard' : f.kind !== 'dashboard'));
        if (!fs.length) { el.innerHTML = `<div class="empty">${dash ? '还没有图表。按下面的按钮做第一个吧。' : '还没有笔记。按下面的按钮开始吧。'}</div>`; return; }
        const icon = { note: '📄', picture: '🖼️', pdf: '📕', dashboard: '📊' };
        el.innerHTML = `<div class="list">${fs.map((f) => `<button class="row" data-f="${esc(f.path)}"><span class="ic">${icon[f.kind] || '📄'}</span><span class="tx"><b>${esc(f.name)}</b><small>${ago(f.mtime)}更新</small></span><span class="go">›</span></button>`).join('')}</div>`;
        $$('[data-f]', el).forEach((b) => { b.onclick = () => go(`#/f/${encodeURIComponent(b.dataset.f)}`); });
      };
      paint();
      loop(async () => { lastFiles = await api('GET', '/family/files'); store.lastFiles = lastFiles; save(); paint(); }, 8000);
    });
  }
  // A chart page runs in a sealed frame (no access to this page or its key). What she types into it is kept by this
  // page per chart: a stand-in localStorage inside the frame posts each change here.
  function dashDoc(html, key) {
    const data = (() => { try { return JSON.parse(localStorage.getItem(`${LS}.dash.${key}`) || '{}') || {}; } catch (e) { return {}; } })();
    const shim = `<script>(function(){var K=${JSON.stringify(key)},d=${JSON.stringify(data).replace(/</g, '\\u003c')};function s(){try{parent.postMessage({fmDash:K,data:d},'*')}catch(e){}}var st={getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v);s()},removeItem:function(k){delete d[k];s()},clear:function(){d={};s()},key:function(i){return Object.keys(d)[i]||null}};Object.defineProperty(st,'length',{get:function(){return Object.keys(d).length}});try{Object.defineProperty(window,'localStorage',{value:st,configurable:true})}catch(e){}})();<\/script>`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + shim) : shim + html;
  }
  window.addEventListener('message', (e) => {
    const f = $('iframe.frame');
    if (!f || e.source !== f.contentWindow || !e.data || typeof e.data.fmDash !== 'string') return;
    try { localStorage.setItem(`${LS}.dash.${e.data.fmDash}`, JSON.stringify(e.data.data || {})); } catch (err) { /* full */ }
  });
  function csvTable(text) {
    const rows = String(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 500).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
    if (!rows.length) return '<p>（空的）</p>';
    return `<table><thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function FileView(p) {
    const name = p.split('/').pop().replace(/\.[^.]+$/, '');
    const ext = (p.split('.').pop() || '').toLowerCase();
    const dash = /^html?$/.test(ext);
    show(`<header class="top line"><button class="back" data-act="back" aria-label="返回">‹</button><h2>${esc(name)}</h2></header>
      <div class="offline-slot" style="padding:0 14px"></div>
      <div id="fv" ${dash ? 'style="flex:1;display:flex;flex-direction:column"' : 'class="main"'}><div class="empty"><span class="spin"></span></div></div>`, () => {
      $('[data-act="back"]').onclick = () => go(dash ? '#/dash' : '#/notes');
      let url = null;
      (async () => {
        const el = $('#fv');
        try {
          const blob = await api('GET', `/family/file?path=${encodeURIComponent(p)}`, undefined, { blob: true, timeout: 60000 });
          if (!(blob instanceof Blob)) throw new Error('这个打不开。');
          if (dash) {
            const f = document.createElement('iframe');
            f.className = 'frame'; f.title = name;
            f.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms allow-modals');
            f.srcdoc = dashDoc(await blob.text(), p);
            el.innerHTML = ''; el.appendChild(f);
            const acts = document.createElement('div'); acts.className = 'fileacts'; acts.style.padding = '0 14px 20px';
            acts.innerHTML = '<button class="btn ghost" data-act="change">✏️ 叫小帮手改一改</button>'; el.appendChild(acts);
          } else if (/^(png|jpe?g|gif|webp|svg)$/.test(ext)) {
            url = URL.createObjectURL(blob); el.innerHTML = `<div class="viewer"><img src="${url}" alt="${esc(name)}"></div>`;
          } else if (ext === 'pdf') {
            url = URL.createObjectURL(blob); el.innerHTML = `<div class="viewer"><p>按下面的按钮打开这个文件。</p><a class="btn" href="${url}" target="_blank" rel="noopener">打开</a></div>`;
          } else {
            const text = await blob.text();
            el.innerHTML = `<div class="viewer">${ext === 'csv' ? csvTable(text) : /^(md|markdown)$/.test(ext) && window.md ? window.md.render(text) : `<pre>${esc(text)}</pre>`}</div>
              <div class="fileacts"><button class="btn ghost" data-act="change">✏️ 叫小帮手改一改</button><button class="btn ghost" data-act="copy">📋 复制文字</button></div>`;
            const cp = $('[data-act="copy"]'); if (cp) cp.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('复制好了')).catch(() => toast('这里不能复制')); };
          }
          const ch = $('[data-act="change"]');
          if (ch) ch.onclick = () => startWith(`请帮我改一改我的${dash ? '图表' : '笔记'}《${name}》：____`);
        } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      })();
      return () => { if (url) URL.revokeObjectURL(url); };
    });
  }

  // ======================================================================================
  // 能做什么: what the helper can do for her, task by task, with ready-made messages
  // ======================================================================================
  function CanView() {
    show(`<header class="top"><h1>小帮手能做什么？</h1></header><div class="main">
      <p class="lead">下面每一样，按<b>「试试看」</b>就会帮你写好要说的话，你只要改一改、按发送。</p>
      ${CAPS.map((c, i) => `<div class="cap"><h3><span class="e">${c.e}</span>${esc(c.t)}</h3>
        <ul>${c.can.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="ex"><b>你说：</b>${esc(c.ex[0])}<br><b>你会得到：</b>${esc(c.ex[1])}</div>
        <div class="tries">${c.tries.map((t, j) => `<button class="try" data-t="${i}-${j}">${t.photo ? '📷 ' : ''}试试看：${esc(t.t)}</button>`).join('')}</div></div>`).join('')}
      <div class="cap limits"><h3><span class="e">🙏</span>它做不到的</h3><ul>
        <li>不能帮你打电话、发 WhatsApp、付钱、上网买东西。</li>
        <li>它有时候也会说错。看病、吃药、钱的大事，请再问医生或家人。</li>
        <li>不要把密码、银行号码、身份证号码写在这里。</li></ul></div>
      <div class="sect">怎么用</div>
      <div class="card"><ol class="how">
        <li>按下面的<b>🏠 首页</b>，再按你想做的事（或者<b>随便问</b>）。</li>
        <li>在下面的框里写你要的东西，就像发短信一样，然后按 <b>➤</b>。</li>
        <li>等一下（会看到三个跳动的点）。有时候它会问你问题，下面有按钮，按你要的那个就好。</li>
        <li>写好的笔记在<b>「笔记」</b>里，图表在<b>「图表」</b>里。</li>
        <li>想改什么，打开它，按<b>「✏️ 叫小帮手改一改」</b>；或者直接在对话里说。</li>
      </ol></div>
      <div class="sect">小提示</div>
      <div class="card"><ul class="tips">
        <li>用中文写就好，它会用中文回答你。</li>
        <li>说得越清楚越好：「每个月开销的圆饼图」比「一个图」好。</li>
        <li>不满意？直接说要怎样改：「字大一点」、「加一个日期」。</li>
        <li>框里的 <b>____</b> 是留给你写的地方。</li>
      </ul></div>
      <div class="sect">这个设备</div>
      <div class="card"><p style="font-size:16px;color:var(--soft)">只有家人叫你按的时候才按：这会让小帮手在这个${isIOS ? '手机' : '设备'}上停下来，之后要新的链接才能再用。</p><button class="btn ghost" data-act="unpair">在这个设备上关掉</button></div>
    </div>${tabs('can')}`, () => {
      $$('[data-t]').forEach((b) => { b.onclick = () => { const t = tryById[b.dataset.t]; startWith(t.say, t.photo); }; });
      $('[data-act="unpair"]').onclick = async () => {
        if (!confirm('确定吗？关掉以后，要新的链接才能再用。')) return;
        try { await api('POST', '/unpair', {}); } catch (e) { /* gone anyway */ }
        delete store.token; save(); route();
      };
    });
  }

  if (!location.hash) history.replaceState(null, '', '#/');
  route();
  if (store.token) pickRoute().catch(() => {});
})();
