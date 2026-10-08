// FoxyMind Phone — see and continue FoxyMind sessions from the iPhone.
// Plain JS, no build step. Talks to <base>/phone/api (see phone/API.md); finds <base> on ntfy.sh.
(() => {
  'use strict';

  const APP_VERSION = '6.0';
  const LS = 'foxyPhone';
  const BREATH = 2400; // ms, the desktop's glow breath
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const appEl = document.getElementById('app');

  // ---------- storage ----------
  let store = {};
  try { store = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { store = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) { /* private mode */ } };
  const lsGet = (k) => { try { return localStorage.getItem(`${LS}.${k}`); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null || v === '') localStorage.removeItem(`${LS}.${k}`); else localStorage.setItem(`${LS}.${k}`, v); } catch (e) { /* ignore */ } };

  // Dev overrides: ?base=http://localhost:8787 talks to that server directly (skips ntfy); ?base=off clears it.
  // ?ntfy=<url> points the address lookup at another ntfy server.
  (() => {
    const q = new URLSearchParams(location.search);
    let touched = false;
    for (const [k, key] of [['base', 'devBase'], ['ntfy', 'ntfy']]) {
      if (!q.has(k)) continue;
      touched = true;
      const v = (q.get(k) || '').trim();
      if (!v || v === 'off') delete store[key]; else store[key] = v.replace(/\/+$/, '');
    }
    if (touched) { save(); history.replaceState(null, '', location.pathname + location.hash); }
  })();

  const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- icons ----------
  const I = {
    fox: '<svg class="fox" viewBox="0 0 64 64" aria-hidden="true"><path d="M6 6l16 14h20L58 6l-4 26c0 14-10 26-22 26S10 46 10 32z" fill="#ff7a1a"/><path d="M18 36c4 0 8 4 14 12 6-8 10-12 14-12-2 10-8 16-14 16s-12-6-14-16z" fill="#fff4ea"/><circle cx="23" cy="30" r="3" fill="#1b1410"/><circle cx="41" cy="30" r="3" fill="#1b1410"/><path d="M29 44h6l-3 3z" fill="#1b1410"/></svg>',
    back: '<svg width="13" height="22" viewBox="0 0 13 22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2 2 11l9 9"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 6.5 6.5l-5 5"/></svg>',
    sessions: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="20" height="17" rx="3.5"/><path d="m7.5 10.5 3 2.5-3 2.5M13 16h5"/></svg>',
    folder: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.6l2.4 2.6h8A2.5 2.5 0 0 1 23 10.1v9.4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 3 19.5z"/></svg>',
    gear: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="13" r="3.4"/><path d="M13 2.8v2.4M13 20.8v2.4M2.8 13h2.4M20.8 13h2.4M5.8 5.8l1.7 1.7M18.5 18.5l1.7 1.7M5.8 20.2l1.7-1.7M18.5 7.5l1.7-1.7"/></svg>',
    photo: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2.5" y="4.5" width="17" height="13" rx="2.6"/><circle cx="8" cy="9.5" r="1.7"/><path d="m3 16 5-4.5 3.5 3 3-2.5 4.5 4" stroke-linecap="round"/></svg>',
    mic: '<svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="6.5" y="2" width="7" height="11.5" rx="3.5"/><path d="M3.5 10.5a6.5 6.5 0 0 0 13 0M10 17v3"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>',
    send: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15V3M3.5 8.5 9 3l5.5 5.5"/></svg>',
    share: '<svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13V2M6 5.5 10 1.6l4 3.9"/><path d="M6.5 8.5H4.5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.5-1.5h-2"/></svg>',
    plusbox: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="2" width="16" height="16" rx="4"/><path d="M10 6.5v7M6.5 10h7"/></svg>',
    plus: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v10M2.5 7.5 7 12l4.5-4.5"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8 15 14H1z"/><path d="M8 6.5v3.2M8 12h.01"/></svg>',
    // v6
    usage: '<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 8h18M4 13h18M4 18h18" opacity=".35"/><path d="M4 8h12M4 13h7M4 18h15"/></svg>',
    bell: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 15.5V10a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M9 19.5a2 2 0 0 0 4 0"/></svg>',
    more: '<svg width="22" height="22" viewBox="0 0 22 22" fill="currentColor"><circle cx="4.5" cy="11" r="1.8"/><circle cx="11" cy="11" r="1.8"/><circle cx="17.5" cy="11" r="1.8"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.8"/><path d="m10.6 10.6 3.6 3.6"/></svg>',
    xsmall: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2 2 8"/></svg>',
    refresh: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.5 3v3.6h-3.6"/></svg>',
    sparkle: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M7 1.8 8.3 5.7 12.2 7 8.3 8.3 7 12.2 5.7 8.3 1.8 7 5.7 5.7z"/><path d="M12.6 10.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor" stroke-width="0"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l5-5 5 5"/></svg>',
    dn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l5 5 5-5"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5l3.5 3.5 7.5-8"/></svg>',
    pencil: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.2l3.3 3.3L7 16.3H3.7V13z"/></svg>',
    swap: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7h12l-3-3M16.5 13h-12l3 3"/></svg>',
    person: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="7" r="3.3"/><path d="M3.8 17c.8-3.2 3.3-5 6.2-5s5.4 1.8 6.2 5"/></svg>',
    restart: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3.5 3v3.6h3.6"/></svg>',
    copy2: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="6.5" y="6.5" width="10" height="10" rx="2.2"/><path d="M13.5 3.5h-8a2 2 0 0 0-2 2v8"/></svg>',
    moon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.2 5.2l1.1 1.1M13.7 13.7l1.1 1.1M5.2 14.8l1.1-1.1M13.7 6.3l1.1-1.1" stroke-linecap="round"/><circle cx="10" cy="10" r="3"/></svg>',
    xbig: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    reopen: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5 3.5 8.5l4 4"/><path d="M3.5 8.5h8.5a4.5 4.5 0 0 1 0 9H9"/></svg>',
    computer: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="10" rx="1.8"/><path d="M7 17h6M10 13.5V17" stroke-linecap="round"/></svg>',
    power: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9 2v6.5"/><path d="M5.2 4.6a6 6 0 1 0 7.6 0"/></svg>',
    k_claude: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 2.5v15M2.5 10h15M4.7 4.7l10.6 10.6M15.3 4.7 4.7 15.3"/></svg>',
    k_codex: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6 3 10l4 4M13 6l4 4-4 4"/></svg>',
    k_grok: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="M5 15 15.5 4.5"/></svg>',
    k_term: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="m6 8 2.5 2L6 12M10.5 12.5h3.5"/></svg>',
    // tool icons
    t_term: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="m4.5 6.5 2 1.5-2 1.5M8.5 10h3"/></svg>',
    t_file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3M5.8 8.5h4.4M5.8 11h4.4" stroke-linecap="round"/></svg>',
    t_edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.8 2.2 13.8 5.2 5.5 13.5H2.5v-3z"/><path d="m9.3 3.7 3 3"/></svg>',
    t_search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg>',
    t_web: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4"/></svg>',
    t_agent: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8l4.9-1.6z"/></svg>',
    t_list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 1.2 1.2L5.5 3M2 9.5l1.2 1.2L5.5 8.5M8 4.2h6M8 9.7h6"/></svg>',
    t_gear: '<svg class="gear" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  };
  function toolIcon(name) {
    const n = String(name || '').toLowerCase();
    if (/bash|shell|exec|command|run|powershell|monitor/.test(n)) return I.t_term;
    if (/^read|view|notebookread|cat/.test(n)) return I.t_file;
    if (/edit|write|patch|apply|notebookedit/.test(n)) return I.t_edit;
    if (/grep|glob|search|find|ls/.test(n)) return /web/.test(n) ? I.t_web : I.t_search;
    if (/web|fetch|browser|navigate|http/.test(n)) return I.t_web;
    if (/task|agent|skill/.test(n)) return I.t_agent;
    if (/todo|plan/.test(n)) return I.t_list;
    return I.t_gear;
  }

  // ---------- small helpers ----------
  // Every breathing element gets the same phase, so dots and glows rise and fall together (like the desktop)
  // even when a list is re-drawn.
  const phase = () => `animation-delay:-${Date.now() % BREATH}ms`;
  function age(ms) {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`;
  }
  function clock(ms) {
    const d = new Date(ms);
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return `Today ${t}`;
    if (diff === 1) return `Yesterday ${t}`;
    return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`;
  }
  function bytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  const COLOR_WORD = { blue: 'waiting', stopped: 'stopped', orange: 'working', half: 'still running', idle: 'idle', asleep: 'asleep', off: 'ended' };
  const STATE_LABEL = { blue: 'Waiting for you', stopped: 'Stopped', orange: 'Working', half: 'Done · still running', idle: 'Idle', asleep: 'Asleep', off: 'Ended' };
  // The model and effort picker (a session's chip, and what a new chat starts on: Opus 5.5 at medium unless picked)
  const MODELS = [['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5']];
  const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'xHigh'], ['max', 'Max']];
  const MODEL_LABEL = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku', fable: 'Fable' };
  const EFFORT_LABEL = Object.fromEntries(EFFORTS);
  const NEW_CHAT = { model: 'opus', effort: 'medium' };
  const modelLabel = (model, effort) => [MODEL_LABEL[model], EFFORT_LABEL[effort]].filter(Boolean).join(' · ');
  function pickerHtml(model, effort) {
    const row = (list, attr, cur) => `<div class="mrow">${list.map(([k, l]) => `<button type="button" data-${attr}="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div>`;
    return `<div class="mpick"><div class="mlab">Model</div>${row(MODELS, 'model', model)}<div class="mlab">Effort</div>${row(EFFORTS, 'effort', effort)}</div>`;
  }
  const machineTag = (s) => `<span class="mtag ${s.machine === 'pc' ? 'pc' : ''}">${esc(s.machineName || (s.machine === 'pc' ? 'Windows' : 'Mac'))}</span>`;

  // "3h 20m" until a time (usage resets)
  function until(ms) {
    if (!ms) return '';
    const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
    const d = Math.floor(h / 24);
    return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
  }

  // toast(msg, kind, { action: 'Undo', onAction }) — an action toast stays a little longer and can be tapped
  function toast(msg, kind, opt) {
    const wrap = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = `toast${kind === 'err' ? ' err' : ''}${opt && opt.action ? ' withact' : ''}`;
    const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
    const out = () => { if (!t.isConnected || t.classList.contains('out')) return; t.classList.add('out'); setTimeout(() => t.remove(), 250); };
    if (opt && opt.action) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = opt.action;
      b.addEventListener('click', () => { out(); try { opt.onAction(); } catch (e) { /* ignore */ } });
      t.appendChild(b);
    }
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(out, opt && opt.action ? 6500 : kind === 'err' ? 3800 : 2200);
  }

  // ---------- bottom sheets (actions, pickers, the bell) ----------
  // sheet({ title, sub, html, onClick(e, sh), onClose }) → { el, body, set(title, html, sub), close() }
  let curSheet = null;
  function sheet(o) {
    if (curSheet) curSheet.close(true);
    const wrap = document.createElement('div');
    wrap.className = 'sheetwrap';
    wrap.innerHTML = `<div class="scrim"></div><div class="sheet${o.cls ? ` ${o.cls}` : ''}" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div><div class="shead"></div><div class="sbody"></div></div>`;
    const panel = $('.sheet', wrap); const head = $('.shead', wrap); const body = $('.sbody', wrap);
    let closed = false;
    const sh = {
      el: wrap, body, panel,
      set(title, html, sub, backBtn) {
        head.innerHTML = title ? `${backBtn ? `<button class="sback" data-act="sback" aria-label="Back">${I.back}</button>` : ''}<div class="stt"><b>${esc(title)}</b>${sub ? `<small>${sub}</small>` : ''}</div>${o.headRight || ''}` : '';
        head.hidden = !title;
        panel.setAttribute('aria-label', title || 'Menu');
        if (html != null) body.innerHTML = html;
        body.scrollTop = 0;
      },
      close(now) {
        if (closed) return; closed = true;
        if (curSheet === sh) curSheet = null;
        if (document.activeElement && wrap.contains(document.activeElement)) document.activeElement.blur();
        if (now) wrap.remove(); else { wrap.classList.remove('open'); panel.style.transform = ''; setTimeout(() => wrap.remove(), 280); }
        if (o.onClose) o.onClose();
      },
    };
    sh.set(o.title, o.html || '', o.sub);
    $('.scrim', wrap).addEventListener('click', () => sh.close());
    wrap.addEventListener('click', (e) => { if (o.onClick) o.onClick(e, sh); });
    wrap.addEventListener('change', (e) => { if (o.onChange) o.onChange(e, sh); });
    // drag the top of the sheet down to close it
    let y0 = null; let dy = 0;
    const startDrag = (e) => { if (e.target.closest('button, input, textarea')) return; y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none'; };
    head.addEventListener('touchstart', startDrag, { passive: true });
    $('.grab', wrap).addEventListener('touchstart', startDrag, { passive: true });
    wrap.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
    wrap.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; panel.style.transition = ''; if (dy > 90) sh.close(); else panel.style.transform = ''; });
    document.body.appendChild(wrap);
    curSheet = sh;
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    return sh;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && curSheet) curSheet.close(); });
  // one row in a sheet: icon, label, optional small line, optional right side
  const actRow = (act, icon, label, opt = {}) => `<button type="button" class="act${opt.danger ? ' danger' : ''}${opt.dim ? ' dim' : ''}" data-act="${act}"${opt.data || ''}${opt.disabled ? ' disabled' : ''}>${icon ? `<span class="aico">${icon}</span>` : ''}<span class="alab">${label}${opt.sub ? `<small>${opt.sub}</small>` : ''}</span>${opt.right || ''}</button>`;

  // ---------- what the server can do (GET /hello → features); older servers hide the new buttons ----------
  const features = () => (data.hello && Array.isArray(data.hello.features) ? data.hello.features : (Array.isArray(store.features) ? store.features : []));
  const has = (f) => features().includes(f);
  // every element with data-feat="a b" shows only when the server has a or b
  function paintFeatures(root) {
    $$('[data-feat]', root || document).forEach((el) => { el.hidden = !el.dataset.feat.split(' ').some(has); });
  }
  function setHello(h) {
    if (!h) return;
    data.hello = h;
    if (h.computer) store.macName = h.computer;
    store.features = Array.isArray(h.features) ? h.features : [];
    save();
    paintConn();
    paintFeatures();
    if (view && view.onHello) view.onHello();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // ---------- viewport: keep the app inside the visible area so the keyboard never covers the composer ----------
  function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
    document.documentElement.style.setProperty('--vvt', `${Math.round(top)}px`);
    document.body.classList.toggle('kb', !!vv && window.innerHeight - vv.height > 120);
    if (view && view.onViewport) view.onViewport();
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitViewport);
    visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  // iOS sometimes scrolls the page itself when the keyboard closes; put it back
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) window.scrollTo(0, 0); fitViewport(); }, 60));

  // A bar's height feeds the scroll padding under/over it
  function watchBars(screen) {
    const top = $('.topbar', screen);
    const bot = $('.botbar', screen);
    const set = () => {
      if (top) screen.style.setProperty('--top-h', `${top.offsetHeight}px`);
      screen.style.setProperty('--bot-h', `${bot && !bot.hidden ? bot.offsetHeight : 0}px`);
    };
    set();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(set);
      if (top) ro.observe(top);
      if (bot) ro.observe(bot);
      return () => ro.disconnect();
    }
    return () => {};
  }

  // ---------- connection ----------
  const conn = { state: store.token ? 'unknown' : 'unknown', lastDiscover: 0 };
  function setConn(s) {
    if (conn.state === s) return;
    conn.state = s;
    paintConn();
  }
  function markOk() {
    const now = Date.now();
    if (!store.lastSeen || now - store.lastSeen > 20000) { store.lastSeen = now; save(); } else store.lastSeen = now;
    setConn('online');
  }
  function connPill() {
    const name = esc(store.macName || 'Mac');
    const label = conn.state === 'online' ? `${name} online` : conn.state === 'reconnecting' ? 'Reconnecting…' : conn.state === 'offline' ? 'Offline' : 'Connecting…';
    return `<span class="connpill ${conn.state}" role="status"><i></i>${label}</span>`;
  }
  function offlineBanner() {
    if (conn.state !== 'offline') return '';
    const seen = store.lastSeen ? ` Last seen ${age(store.lastSeen)} ago.` : '';
    return `<div class="offbanner"><div class="grow"><b>Mac is offline or asleep</b>Showing the last update.${seen}</div><button class="btn-sm" data-act="retry">Retry</button></div>`;
  }
  function paintConn() {
    $$('.connpill').forEach((el) => { el.outerHTML = connPill(); });
    $$('.offline-slot').forEach((el) => { el.innerHTML = offlineBanner(); });
    $$('.scroll.can-stale').forEach((el) => el.classList.toggle('stale', conn.state === 'offline'));
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="retry"]');
    if (!b) return;
    setConn('reconnecting');
    conn.lastDiscover = 0;
    kickAll();
  });

  // ---------- finding the Mac + API ----------
  const ntfyBase = () => store.ntfy || 'https://ntfy.sh';
  const currentBase = () => store.devBase || store.base || null;
  let discovering = null;
  async function discover() {
    if (store.devBase) return store.devBase;
    if (!store.topic) throw new Error('This phone isn\'t paired');
    conn.lastDiscover = Date.now();
    const r = await fetch(`${ntfyBase()}/${encodeURIComponent(store.topic)}/json?poll=1&since=24h`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Couldn\'t look up the Mac\'s address');
    const txt = await r.text();
    let url = null;
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o && o.event === 'message' && typeof o.message === 'string' && o.message.startsWith('url: ')) url = o.message.slice(5).trim();
      } catch (e) { /* skip */ }
    }
    if (!url) throw new Error('The Mac hasn\'t posted its address yet. Is FoxyMind running?');
    store.base = url.replace(/\/+$/, '');
    save();
    return store.base;
  }
  function rediscover() {
    if (!discovering) discovering = discover().finally(() => { discovering = null; });
    return discovering;
  }

  class ApiError extends Error {
    constructor(msg, status, offline) { super(msg); this.status = status; this.offline = !!offline; }
  }
  const BAD_GATEWAY = [502, 503, 504, 520, 521, 522, 523, 524, 530];

  async function api(method, path, body, opts = {}) {
    const auth = opts.auth !== false;
    let base = currentBase();
    if (!base) {
      setConn('reconnecting');
      try { base = await rediscover(); } catch (e) { setConn('offline'); throw new ApiError(e.message || 'Can\'t find your Mac', 0, true); }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = null;
      let data = null;
      let bad = false;
      try {
        const headers = {};
        if (opts.raw) headers['Content-Type'] = opts.type || 'application/octet-stream'; // (a photo, a piece of sound)
        else if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth && store.token) headers.Authorization = `Bearer ${store.token}`;
        const ctl = window.AbortController ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || 15000) : null;
        res = await fetch(`${base}/phone/api${path}`, {
          method, headers, mode: 'cors', cache: 'no-store', credentials: 'omit',
          body: opts.raw ? opts.raw : body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctl ? ctl.signal : undefined,
        });
        const text = await res.text();
        if (timer) clearTimeout(timer);
        try { data = text ? JSON.parse(text) : {}; } catch (e) { bad = true; } // a Cloudflare error page
        if (BAD_GATEWAY.includes(res.status)) bad = true;
      } catch (e) { bad = true; }

      if (!bad) {
        if (res.status === 401 && auth) { onRevoked(); throw new ApiError('This phone was unpaired', 401); }
        markOk();
        if (!res.ok) throw new ApiError((data && data.error) || `Something went wrong (${res.status})`, res.status);
        return data;
      }
      if (attempt > 0) break;
      setConn('reconnecting');
      if (store.devBase) { await sleep(400); continue; }
      // the tunnel may have moved: read the current address from ntfy (not more than every 15 s)
      if (!store.topic || Date.now() - conn.lastDiscover < 15000) break;
      try {
        const nb = await rediscover();
        base = nb;
      } catch (e) { break; }
    }
    setConn('offline');
    throw new ApiError('Can\'t reach your Mac', 0, true);
  }

  function onRevoked() {
    const had = !!store.token;
    delete store.token; delete store.base; delete store.deviceId;
    save();
    stopGlobal();
    if (had) toast('This phone was unpaired. Pair it again to continue.', 'err');
    location.hash = '#/';
    route();
  }

  // ---------- polling ----------
  // A loop runs while the app is visible; switching back to the app runs every loop at once.
  const loops = new Set();
  function loop(fn, ms) {
    let stopped = false; let timer = null; let running = false;
    const next = () => (conn.state === 'offline' ? Math.max(ms, 8000) : ms);
    const tick = async () => {
      timer = null;
      if (stopped || document.hidden) return;
      running = true;
      try { await fn(); } catch (e) { /* shown by the connection pill */ }
      running = false;
      if (!stopped && !document.hidden && !timer) timer = setTimeout(tick, next());
    };
    const kick = () => {
      if (stopped || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      tick();
    };
    loops.add(kick);
    tick();
    return { stop() { stopped = true; if (timer) clearTimeout(timer); loops.delete(kick); }, kick };
  }
  function kickAll() { loops.forEach((k) => k()); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kickAll(); });
  window.addEventListener('focus', kickAll);
  window.addEventListener('online', () => { conn.lastDiscover = 0; kickAll(); });

  // ---------- shared data: sessions (feeds the list, the session header and the tab badge) ----------
  const data = { sessions: null, counts: { blue: 0, orange: 0, half: 0 }, at: 0, hello: null, folders: null, notes: null, machines: null, usage: null };
  const subs = new Set();
  let sessionsLoop = null;
  async function fetchSessions() {
    const r = await api('GET', '/sessions');
    data.sessions = Array.isArray(r.sessions) ? r.sessions : [];
    data.counts = r.counts || { blue: 0, orange: 0, half: 0 };
    data.at = Date.now();
    try { store.lastSessions = data.sessions.slice(0, 40); store.lastCounts = data.counts; } catch (e) { /* ignore */ }
    paintBadges();
    subs.forEach((f) => f());
  }
  // the bell (the Mac's notifications) and the computers (Mac + Windows twin): polled while the app is open
  let notesLoop = null; let machinesLoop = null;
  async function fetchNotes() {
    if (!has('notifications')) return;
    const r = await api('GET', '/notifications');
    data.notes = { unread: r.unread || 0, items: Array.isArray(r.items) ? r.items : [] };
    paintBell();
    subs.forEach((f) => f('notes'));
  }
  async function fetchMachines() {
    if (!has('machines')) return;
    const r = await api('GET', '/machines');
    data.machines = { machines: Array.isArray(r.machines) ? r.machines : [], everythingOn: r.everythingOn || null, moving: r.moving || null };
    subs.forEach((f) => f('machines'));
  }
  function paintBell() {
    const n = (data.notes && data.notes.unread) || 0;
    $$('.bellbtn').forEach((b) => { b.classList.toggle('unread', n > 0); b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications'); });
  }
  function startGlobal() {
    if (!sessionsLoop) sessionsLoop = loop(fetchSessions, 3000);
    if (!notesLoop) notesLoop = loop(fetchNotes, 20000);
    if (!machinesLoop) machinesLoop = loop(fetchMachines, 15000);
    if (!data.hello) api('GET', '/hello').then((h) => { setHello(h); if (notesLoop) notesLoop.kick(); if (machinesLoop) machinesLoop.kick(); }).catch(() => {});
  }
  function stopGlobal() {
    if (sessionsLoop) { sessionsLoop.stop(); sessionsLoop = null; }
    if (notesLoop) { notesLoop.stop(); notesLoop = null; }
    if (machinesLoop) { machinesLoop.stop(); machinesLoop = null; }
    data.sessions = null; data.hello = null; data.folders = null; data.notes = null; data.machines = null; data.usage = null;
  }
  // last list from a previous run, so a cold start (or an offline one) shows something at once
  if (store.token && Array.isArray(store.lastSessions)) { data.sessions = store.lastSessions; data.counts = store.lastCounts || data.counts; }
  window.addEventListener('pagehide', save);

  function paintBadges() {
    const n = (data.counts && data.counts.blue) || 0;
    $$('.tab .badge').forEach((b) => { b.textContent = n; b.hidden = !n; });
    try { if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) { /* not allowed */ }
  }

  // ---------- router ----------
  let view = null;
  let navDir = 'fade';
  function show(next) {
    if (curSheet) curSheet.close(true);
    if (view && view.destroy) view.destroy();
    appEl.innerHTML = '';
    view = next;
    next.el.classList.add(navDir === 'push' ? 'enter-push' : navDir === 'pop' ? 'enter-pop' : 'enter-fade');
    paintFeatures(next.el);
    appEl.appendChild(next.el);
    paintBell();
    navDir = 'fade';
    if (next.mounted) next.mounted();
    fitViewport();
  }
  function go(hash, dir) { navDir = dir || 'fade'; if (location.hash === hash) route(); else location.hash = hash; }

  // Back: step back in history when we came from inside the app (keeps history short), else go to `fallback`
  let curHash = null; let prevHash = null;
  function back(fallback) {
    const p = prevHash;
    if (p && p !== curHash && !p.startsWith('#pair') && (fallback === '#/' ? !p.startsWith('#/s/') : true)) { navDir = 'pop'; history.back(); }
    else go(fallback, 'pop');
  }

  function route() {
    const h = location.hash || '';
    if (h !== curHash) { prevHash = curHash; curHash = h; }
    if (h.startsWith('#pair=')) {
      const raw = decodeURIComponent(h.slice(6));
      if (isStandalone() || !isIOS) {
        if (store.token && store.pairedWith === raw) { history.replaceState(null, '', '#/'); return route(); }
        return show(PairView({ autoPair: raw }));
      }
      return show(PairView({ safariLink: location.href }));
    }
    if (!store.token) return show(PairView({}));
    startGlobal();
    let m;
    if ((m = h.match(/^#\/s\/(.+)$/))) return show(SessionView(decodeURIComponent(m[1])));
    if ((m = h.match(/^#\/f\/(.+)$/))) return show(FolderView(decodeURIComponent(m[1])));
    if (h === '#/folders') return show(FoldersView());
    if (h === '#/settings') return show(SettingsView());
    if (h === '#/usage') return show(UsageView());
    return show(SessionsView());
  }
  window.addEventListener('hashchange', route);

  function tabbar(active) {
    const n = (data.counts && data.counts.blue) || 0;
    const t = (id, href, icon, label) => `<a class="tab${active === id ? ' on' : ''}" href="${href}" data-tab="${id}" aria-label="${label}"${id === 'usage' ? ' data-feat="usage"' : ''}>${icon}<span>${label}</span>${id === 'sessions' ? `<span class="badge"${n ? '' : ' hidden'}>${n}</span>` : ''}</a>`;
    return `<nav class="botbar tabbar">${t('sessions', '#/', I.sessions, 'Sessions')}${t('folders', '#/folders', I.folder, 'Folders')}${t('usage', '#/usage', I.usage, 'Usage')}${t('settings', '#/settings', I.gear, 'Settings')}</nav>`;
  }
  function screenEl(cls, html) {
    const el = document.createElement('section');
    el.className = `screen ${cls}`;
    el.innerHTML = html;
    return el;
  }

  // ======================================================================================
  // Pairing
  // ======================================================================================
  function parsePair(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    try { s = decodeURIComponent(s); } catch (e) { /* keep */ }
    const m = s.match(/#?pair=([^\s&#]+)/);
    if (m) s = m[1];
    s = s.replace(/[\s'"<>]+$/g, '');
    const strict = s.match(/(fm-phone-[0-9a-f]{24})\.([0-9a-f]{32})/i);
    if (strict) return { topic: strict[1], code: strict[2], raw: `${strict[1]}.${strict[2]}` };
    const loose = s.match(/^([A-Za-z0-9_-]{3,64})\.([A-Za-z0-9]{6,128})$/);
    if (loose) return { topic: loose[1], code: loose[2], raw: `${loose[1]}.${loose[2]}` };
    return null;
  }

  async function pair(raw) {
    const p = parsePair(raw);
    if (!p) throw new Error('That doesn\'t look like a pair link. It ends with #pair=…');
    store.topic = p.topic;
    delete store.base;
    save();
    if (!store.devBase) {
      try { await discover(); } catch (e) { throw new Error(`Can't find your Mac. ${e.message || ''}`.trim()); }
    }
    let r;
    try {
      r = await api('POST', '/pair', { code: p.code, name: 'iPhone' }, { auth: false });
    } catch (e) {
      if (e.offline) throw new Error('Can\'t reach your Mac. Is it awake with FoxyMind open?');
      if (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 410) throw new Error(`${e.message}. Ask FoxyMind for a new pair link.`);
      throw e;
    }
    if (!r || !r.token) throw new Error('The Mac didn\'t send a key back. Try a new pair link.');
    store.token = r.token;
    store.deviceId = r.deviceId;
    store.macName = r.name || 'Mac';
    store.pairedAt = Date.now();
    store.pairedWith = p.raw;
    save();
  }

  function PairView(opts) {
    const standalone = isStandalone();
    const safari = !!opts.safariLink || (isIOS && !standalone);
    const heroHtml = `<div class="hero"><div class="foxbig">${I.fox}</div><h1>FoxyMind</h1><p>Your sessions, on your phone.</p></div>`;
    let body;
    if (safari) {
      body = `${heroHtml}
        <div class="card"><ol class="steps">
          <li><span class="num">1</span><span>Tap <b>Share</b> <span class="ico">${I.share}</span> then <b>Add to Home Screen</b> <span class="ico">${I.plusbox}</span>.</span></li>
          <li><span class="num">2</span><span>Open <b>FoxyMind</b> from your Home Screen.</span></li>
          <li><span class="num">3</span><span>Paste your pair link there.</span></li>
        </ol></div>
        ${opts.safariLink ? `<div class="pad"><button class="btn primary" data-act="copy">Copy pair link</button></div>
        <p class="fine">Copy it now: your iPhone keeps the Home Screen app separate from Safari, so the link is pasted there.</p>` : '<p class="fine">Get your pair link from FoxyMind on your Mac (Settings → Phone) or from Telegram.</p>'}`;
    } else {
      body = `${heroHtml}
        <div class="card">
          <h3>Paste pair link</h3>
          <textarea class="pairbox" rows="3" placeholder="https://…#pair=…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Pair link"></textarea>
          <div class="btnrow"><button class="btn secondary" data-act="paste">Paste</button><button class="btn primary" data-act="pair" disabled>Pair</button></div>
          <p class="err" role="alert"></p>
        </div>
        <p class="fine">Get your pair link from FoxyMind on your Mac (Settings → Phone) or from Telegram.</p>`;
    }
    const el = screenEl('pair', `<div class="scroll"><div>${body}</div></div>`);
    const box = $('.pairbox', el);
    const btn = $('[data-act="pair"]', el);
    const err = $('.err', el);

    async function doPair(raw) {
      if (!btn) return;
      err.textContent = '';
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Pairing…';
      try {
        await pair(raw);
        toast(`Paired with ${store.macName || 'your Mac'}`);
        history.replaceState(null, '', location.pathname + location.search + '#/');
        route();
      } catch (e) {
        err.textContent = e.message || String(e);
        btn.disabled = !(box && box.value.trim());
        btn.textContent = 'Pair';
      }
    }
    if (box) {
      box.addEventListener('input', () => { btn.disabled = !box.value.trim(); err.textContent = ''; });
      btn.addEventListener('click', () => doPair(box.value));
      $('[data-act="paste"]', el).addEventListener('click', async () => {
        try {
          const t = await navigator.clipboard.readText();
          if (!t) throw new Error('empty');
          box.value = t.trim();
          btn.disabled = false;
          if (parsePair(t)) doPair(t);
        } catch (e) {
          box.focus();
          err.textContent = 'Couldn\'t read the clipboard. Press and hold in the box, then Paste.';
        }
      });
    }
    const copy = $('[data-act="copy"]', el);
    if (copy) {
      copy.addEventListener('click', async () => {
        const ok = await copyText(opts.safariLink);
        copy.textContent = ok ? 'Copied' : 'Couldn\'t copy. Press and hold the address bar to copy.';
        if (ok) setTimeout(() => { copy.textContent = 'Copy pair link'; }, 2500);
      });
    }
    return {
      el,
      mounted() {
        if (opts.autoPair && box) { box.value = opts.autoPair; btn.disabled = false; doPair(opts.autoPair); }
      },
    };
  }

  // ======================================================================================
  // Sessions list
  // ======================================================================================
  const GROUPS = [
    { id: 'need', label: 'Needs you', colors: ['blue', 'stopped'] },
    { id: 'work', label: 'Working', colors: ['orange', 'half'] },
    { id: 'idle', label: 'Idle', colors: ['idle'] },
    { id: 'sleep', label: 'Asleep / ended', colors: ['asleep', 'off'], fold: true },
  ];
  function groupOf(color) {
    for (const g of GROUPS) if (g.colors.includes(color)) return g.id;
    return 'sleep';
  }

  // ---------- computers: the Windows twin's state, Wake, "Everything on" ----------
  const pcMachine = () => (data.machines && data.machines.machines.find((m) => m.id === 'pc')) || null;
  function machineState(m) {
    if (!m) return { word: 'Unknown', cls: '' };
    if (m.asleep) return { word: 'Asleep', cls: 'asleep' };
    if (!m.online) return { word: 'Offline', cls: 'off' };
    if (m.full) return { word: 'Full', cls: 'full' };
    return { word: 'Online', cls: 'on' };
  }
  // the line over the sessions list when Windows can't take work ("Windows is asleep — Wake")
  // a "move everything" under way (or just done): "Moving to Windows · 3 of 7"
  function movingLine() {
    const mv = data.machines && data.machines.moving;
    if (!mv || mv.cancelled) return '';
    const to = esc(mv.toName || (mv.to === 'pc' ? 'Windows' : 'the Mac'));
    const n = mv.total ? ` · ${mv.done || 0} of ${mv.total}` : '';
    if (mv.finished) return `<div class="pcbar moving done"><span class="pdot"></span><span class="grow">Moved everything to ${to}${n}${mv.failed ? `<small>${mv.failed} couldn't move.</small>` : ''}</span></div>`;
    return `<div class="pcbar moving"><span class="spin sm"></span><span class="grow">Moving everything to ${to}${n}<small>Each session moves once its reply finishes.</small></span><button class="btn-sm" data-act="mvstop">Stop</button></div>`;
  }
  async function stopMoving(btn) {
    if (btn) btn.disabled = true;
    try { await api('DELETE', '/move-all'); if (data.machines) data.machines.moving = null; toast('Stopped. Sessions not moved yet stay where they are.'); subs.forEach((f) => f('machines')); }
    catch (e) { toast(e.offline ? 'Can\'t reach your Mac' : e.message, 'err'); if (btn) btn.disabled = false; }
  }
  function pcStatusLine() {
    if (!has('machines')) return '';
    const pc = pcMachine();
    const mv = movingLine();
    if (!pc || (pc.online && !pc.asleep && !pc.full)) return mv;
    const name = esc(pc.name || 'Windows');
    if (pc.asleep || !pc.online) {
      return `${mv}<div class="pcbar ${pc.asleep ? 'asleep' : 'off'}"><span class="pdot"></span><span class="grow">${esc(pc.note || `${pc.name || 'Windows'} is ${pc.asleep ? 'asleep' : 'offline'}.`)}<small>New sessions open on the Mac until it's back.</small></span><button class="btn-sm" data-act="pcwake">Wake</button></div>`;
    }
    return `${mv}<div class="pcbar full"><span class="pdot"></span><span class="grow">${esc(pc.note || `${name} is full.`)}<small>No room for more there; new sessions open on the Mac.</small></span></div>`;
  }
  async function wakePc(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span>'; }
    try {
      const r = await api('POST', '/machines/pc/wake', {});
      toast(r && r.already ? 'Windows is already on.' : 'Waking Windows… it takes a minute or two.');
      setTimeout(() => { if (machinesLoop) machinesLoop.kick(); }, 4000);
    } catch (e) { toast(e.offline ? 'Can\'t reach your Mac' : `Couldn't wake it: ${e.message}`, 'err'); }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Wake'; }
  }
  // the title bar's "Everything on" move-all switch: Off · Mac · Windows
  function everythingSeg() {
    const cur = (data.machines && data.machines.everythingOn) || 'off';
    const b = (k, l) => `<button type="button" data-every="${k}" class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k}">${l}</button>`;
    return `<div class="mrow every">${b('off', 'Off')}${b('mac', 'Mac')}${b('pc', 'Windows')}</div>`;
  }
  async function setEverything(to, after) {
    const cur = (data.machines && data.machines.everythingOn) || 'off';
    if (to === cur) { if (after) after(); return; }
    if (to !== 'off' && !window.confirm(`Move every session to ${to === 'pc' ? 'Windows' : 'the Mac'} and keep new ones there?`)) { if (after) after(); return; }
    try {
      if (to === 'off') await api('DELETE', '/move-all'); else await api('POST', '/move-all', { to });
      if (data.machines) data.machines.everythingOn = to === 'off' ? null : to;
      toast(to === 'off' ? 'Everything on is off. Sessions stay where they are.' : `Moving everything to ${to === 'pc' ? 'Windows' : 'the Mac'}…`);
      setTimeout(() => { if (machinesLoop) machinesLoop.kick(); if (sessionsLoop) sessionsLoop.kick(); }, 250);
    } catch (e) { toast(e.offline ? 'Can\'t reach your Mac' : `Not changed: ${e.message}`, 'err'); }
    if (after) after();
  }

  // ---------- the ⋯ menu over the sessions list ----------
  function openSessionsMore() {
    const html = () => `${has('reopen') ? actRow('reopen', I.reopen, 'Reopen closed window', { sub: 'The last window you closed, like ⌘⇧T' }) : ''}
      ${has('machines') ? `<div class="sgroup"><div class="slabel">Everything on</div>${everythingSeg()}<p class="sfoot">Moves every session to one computer and keeps new ones there.</p></div>` : ''}`;
    let busy = false;
    sheet({
      title: 'Sessions', html: html(),
      async onClick(e, sh) {
        const ev = e.target.closest('[data-every]');
        if (ev) {
          if (busy) return;
          busy = true;
          $$('[data-every]', sh.body).forEach((x) => x.classList.toggle('on', x === ev));
          await setEverything(ev.dataset.every, () => { busy = false; if (sh.body.isConnected) sh.set('Sessions', html()); });
          return;
        }
        const b = e.target.closest('[data-act="reopen"]');
        if (!b || busy) return;
        busy = true; b.classList.add('busy');
        try {
          const r = await api('POST', '/reopen', {});
          sh.close();
          toast('Window reopened');
          if (sessionsLoop) sessionsLoop.kick();
          if (r && r.sessionId) go(`#/s/${encodeURIComponent(r.sessionId)}`, 'push');
        } catch (err) { toast(err.offline ? 'Can\'t reach your Mac' : err.message, 'err'); busy = false; b.classList.remove('busy'); }
      },
    });
  }

  // ---------- the bell: the Mac's notifications ----------
  function openBell() {
    const body = () => {
      const n = data.notes;
      if (!n) return '<div class="sempty"><span class="spin"></span></div>';
      if (!n.items.length) return '<div class="sempty"><b>No notifications</b>FoxyMind\'s alerts from your computers show up here.</div>';
      return `<div class="notes">${n.items.map((x) => `<button type="button" class="note-row${x.read ? '' : ' unread'}" data-note="${esc(x.id)}"${x.sessionId ? ` data-sid="${esc(x.sessionId)}"` : ''}>
        <span class="ndot"></span><span class="ntext"><span class="nt">${esc(x.title || 'FoxyMind')}</span>${x.body ? `<span class="nb">${esc(x.body)}</span>` : ''}</span><span class="nage">${esc(age(x.at))}</span></button>`).join('')}</div>`;
    };
    const headRight = '<div class="shacts"><button type="button" class="slink" data-act="nread">Read all</button><button type="button" class="slink" data-act="nclear">Clear</button></div>';
    const onNotes = (what) => { if (what === 'notes' && sh.body.isConnected) sh.set('Notifications', body()); };
    const sh = sheet({
      title: 'Notifications', html: body(), cls: 'tall', headRight,
      async onClick(e) {
        const a = e.target.closest('[data-act]');
        if (a && a.dataset.act === 'nread') {
          try {
            await api('POST', '/notifications/read', {});
            if (data.notes) { data.notes.items.forEach((x) => { x.read = true; }); data.notes.unread = 0; }
            paintBell(); sh.set('Notifications', body());
          } catch (err) { toast(err.message, 'err'); }
          return;
        }
        if (a && a.dataset.act === 'nclear') {
          if (!data.notes || !data.notes.items.length) return;
          try { await api('DELETE', '/notifications'); data.notes = { unread: 0, items: [] }; paintBell(); sh.set('Notifications', body()); } catch (err) { toast(err.message, 'err'); }
          return;
        }
        const r = e.target.closest('.note-row');
        if (!r) return;
        const it = data.notes && data.notes.items.find((x) => String(x.id) === r.dataset.note);
        if (it && !it.read) {
          it.read = true; data.notes.unread = Math.max(0, (data.notes.unread || 0) - 1); paintBell(); r.classList.remove('unread');
          api('POST', '/notifications/read', { id: it.id }).catch(() => {});
        }
        if (r.dataset.sid) { sh.close(); go(`#/s/${encodeURIComponent(r.dataset.sid)}`, 'push'); }
      },
      onClose() { subs.delete(onNotes); },
    });
    subs.add(onNotes);
    if (notesLoop) notesLoop.kick();
  }

  function sessionRow(s) {
    const c = s.color || 'off';
    const when = s.since || s.lastOutputAt;
    const word = COLOR_WORD[c] || '';
    const meta = when ? `${word} ${age(when)}` : word;
    const sub = s.ask
      ? `<span class="askt">Asked you something</span><span class="fo">· ${esc(s.folder || '')}</span>`
      : `<span class="fo">${esc(s.folder || '')}</span>${machineTag(s)}`;
    return `<a class="srow" href="#/s/${encodeURIComponent(s.id)}" data-id="${esc(s.id)}">
      <span class="dot c-${esc(c)}" style="@PH@"></span>
      <span class="smain"><span class="stitle">${esc(s.title || 'Untitled')}</span><span class="ssub">${sub}</span></span>
      <span class="smeta ${esc(c)}">${esc(meta)}</span>${I.chev}</a>`;
  }

  function SessionsView() {
    const el = screenEl('sessions', `
      <header class="topbar">
        <div class="brandrow">${I.fox}<h1>FoxyMind</h1>
          <button class="ibtn bellbtn" data-act="bell" data-feat="notifications" aria-label="Notifications">${I.bell}<i></i></button>
          <button class="ibtn" data-act="smore" data-feat="reopen machines" aria-label="More">${I.more}</button>
        </div>
        <div class="subrow"><span class="counts"></span>${connPill()}</div>
        <div class="searchrow"><label class="search">${I.search}<input type="search" class="sq" placeholder="Search sessions" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search sessions"><button type="button" class="sclear" data-act="sclear" aria-label="Clear search" hidden>${I.xsmall}</button></label></div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll can-stale"><div class="pcline"></div><div class="groups"></div></div>
      ${tabbar('sessions')}`);
    const groupsEl = $('.groups', el);
    const subrow = $('.subrow .counts', el);
    const scroll = $('.scroll', el);
    const pcline = $('.pcline', el);
    const sq = $('.sq', el);
    let query = '';
    let lastHtml = '';
    let unwatch = () => {};

    function render() {
      pcline.innerHTML = pcStatusLine();
      const c = data.counts || {};
      const waiting = c.blue || 0;
      const working = (c.orange || 0) + (c.half || 0);
      subrow.innerHTML = (waiting || working)
        ? `${waiting ? `<span class="count blue"><i></i>${waiting} waiting</span>` : ''}${working ? `<span class="count orange"><i></i>${working} working</span>` : ''}`
        : `<span class="count none">${data.sessions ? 'Nothing needs you right now' : ''}</span>`;
      if (!data.sessions) {
        groupsEl.innerHTML = '<div class="glabel">&nbsp;</div><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
        return;
      }
      if (!data.sessions.length) {
        const html = `<div class="empty"><b>No sessions open</b>Start one from a folder.<a class="btn secondary" href="#/folders">Open Folders</a></div>`;
        if (html !== lastHtml) { groupsEl.innerHTML = html; lastHtml = html; }
        return;
      }
      const by = { need: [], work: [], idle: [], sleep: [] };
      const ql = query.trim().toLowerCase();
      const match = (s) => !ql || `${s.title || ''} ${s.folder || ''}`.toLowerCase().includes(ql);
      const list0 = data.sessions.filter(match);
      if (!list0.length) {
        const html = `<div class="empty"><b>No matches</b>No session title or folder has “${esc(query.trim())}”.</div>`;
        if (html !== lastHtml) { groupsEl.innerHTML = html; lastHtml = html; }
        return;
      }
      for (const s of list0) by[groupOf(s.color)].push(s);
      const sleepOpen = lsGet('sleepOpen') === '1' || !!ql;
      let html = '';
      for (const g of GROUPS) {
        const list = by[g.id];
        if (!list.length) continue;
        if (g.fold) {
          html += `<button class="glabel ${g.id}${sleepOpen ? ' open' : ''}" data-act="fold" aria-expanded="${sleepOpen}">${I.chev.replace('class="chev"', 'class="chev" style="color:inherit"')}${g.label} <span class="n">· ${list.length}</span></button>`;
          if (!sleepOpen) continue;
        } else {
          html += `<div class="glabel ${g.id}">${g.label} <span class="n">· ${list.length}</span></div>`;
        }
        html += `<div class="list ${g.id}">${list.map(sessionRow).join('')}</div>`;
      }
      if (html !== lastHtml) {
        lastHtml = html;
        groupsEl.innerHTML = html.split('@PH@').join(phase());
      }
    }
    sq.addEventListener('input', () => { query = sq.value; $('.sclear', el).hidden = !query; render(); });
    sq.addEventListener('keydown', (e) => { if (e.key === 'Enter') sq.blur(); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'sclear') { sq.value = ''; query = ''; b.hidden = true; render(); sq.focus(); }
      else if (act === 'bell') openBell();
      else if (act === 'smore') openSessionsMore();
      else if (act === 'pcwake') wakePc(b);
      else if (act === 'mvstop') stopMoving(b);
    });
    groupsEl.addEventListener('click', (e) => {
      const f = e.target.closest('[data-act="fold"]');
      if (f) { lsSet('sleepOpen', lsGet('sleepOpen') === '1' ? '' : '1'); render(); return; }
      const a = e.target.closest('a.srow');
      if (a) { e.preventDefault(); go(a.getAttribute('href'), 'push'); }
    });

    // pull down past the top to refresh now
    let pullStart = null;
    scroll.addEventListener('touchstart', (e) => { pullStart = scroll.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    scroll.addEventListener('touchend', (e) => {
      if (pullStart == null) return;
      const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : 0) - pullStart;
      pullStart = null;
      if (dy > 90 && sessionsLoop) { sessionsLoop.kick(); toast('Refreshing…'); }
    }, { passive: true });

    const tick = setInterval(render, 15000); // ages ("waiting 4m") move on between polls
    return {
      el,
      mounted() { unwatch = watchBars(el); subs.add(render); render(); if (sessionsLoop) sessionsLoop.kick(); if (machinesLoop) machinesLoop.kick(); },
      onHello() { lastHtml = ''; render(); },
      destroy() { subs.delete(render); clearInterval(tick); unwatch(); },
    };
  }

  // ======================================================================================
  // One session: Chat | Screen + composer
  // ======================================================================================
  const KEYS = [
    ['1', '1', 'num'], ['2', '2', 'num'], ['3', '3', 'num'], ['4', '4', 'num'],
    ['↑', 'up'], ['↓', 'down'], ['Enter', 'enter', 'wide'], ['Stop', 'esc', 'wide'],
  ]; // (no ^C: pressed twice it quits Claude)

  // Claude's (or Codex's) on-screen question → { question, context, options: [{ n, label, desc }] }, or null.
  // Reads the last numbered list on the screen: "❯ 1. Yes", "  2. Yes, and don't ask again…", "  3. No… (esc)".
  function parseQuestion(text) {
    const lines = String(text || '').split('\n').map((l) => l.replace(/[│╭╮╰╯┌┐└┘]/g, ' ').replace(/\s+$/, ''));
    const OPT = /^(\s*)([❯>›→]?)\s*(\d)\.\s+(\S.*)$/;
    let last = -1;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) if (OPT.test(lines[i])) { last = i; break; }
    if (last < 0) return null;
    let first = -1;
    for (let i = last; i >= Math.max(0, last - 40); i--) { const m = OPT.exec(lines[i]); if (m && m[3] === '1') { first = i; break; } }
    if (first < 0) return null;
    const options = []; let cur = null;
    const isFooter = (t) => /Enter to (select|confirm)|Esc to (cancel|go back)|↑\/↓|Tab to/i.test(t);
    for (let i = first; i < lines.length; i++) {
      const t = lines[i].trim();
      const m = OPT.exec(lines[i]);
      if (m && Number(m[3]) === options.length + 1) { cur = { n: m[3], label: m[4].replace(/\s*\((esc|y|n)\)\s*$/i, '').trim(), desc: '' }; options.push(cur); continue; }
      if (i > last && (!t || isFooter(t))) break;
      if (!t || /^[─━—-]{3,}$/.test(t) || isFooter(t)) continue;
      if (cur) cur.desc += (cur.desc ? ' ' : '') + t;
    }
    if (options.length < 2) return null;
    // the question (and what it's about) = the text blocks just above the options
    const blocks = []; let blk = [];
    for (let i = first - 1; i >= Math.max(0, first - 24) && blocks.length < 3; i--) {
      const t = lines[i].trim();
      if (/^[─━—-]{3,}$/.test(t) || /^[●⏺✻>]/.test(t)) { if (blk.length) blocks.push(blk); blk = []; break; }
      if (!t) { if (blk.length) { blocks.push(blk); blk = []; } continue; }
      blk.unshift(t);
    }
    if (blk.length && blocks.length < 3) blocks.push(blk);
    if (!blocks.length) return null;
    // the question = the last line ending in "?" (else the nearest block); everything else = what it is about
    const all = blocks.reverse().map((b) => b.map((t) => t.replace(/^[›☐❯]\s*/, '')));
    let qi = -1; let qj = -1;
    all.forEach((b, i) => b.forEach((t, j) => { if (/\?\s*$/.test(t)) { qi = i; qj = j; } }));
    let question;
    if (qi >= 0) { question = all[qi][qj]; all[qi].splice(qj, 1); } else question = all.pop().join(' ');
    const context = all.filter((b) => b.length).map((b) => b.join('\n')).join('\n\n');
    return { question, context, options };
  }
  const pendingBySession = new Map(); // id -> [{ text, sentAt, status, baseCount }]

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function renderParts(parts) {
    let out = '';
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const chips = run.map((t) => `<div class="chip">${toolIcon(t.name)}<span class="n">${esc(t.name || 'Tool')}</span>${t.summary ? `<span class="s">${esc(t.summary)}</span>` : ''}</div>`).join('');
      if (run.length <= 3) out += `<div class="tools">${chips}</div>`;
      else {
        const tally = {};
        for (const t of run) tally[t.name || 'Tool'] = (tally[t.name || 'Tool'] || 0) + 1;
        const what = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ');
        out += `<details class="toolrun"><summary>${I.t_gear}<b>${run.length} steps</b><span class="what">${esc(what)}</span>${I.chev}</summary><div class="tools">${chips}</div></details>`;
      }
      run = [];
    };
    for (const p of parts || []) {
      if (!p) continue;
      if (p.type === 'tool') { run.push(p); continue; }
      flush();
      if (p.type === 'text' && p.text && p.text.trim()) {
        // code blocks scroll sideways, so their Copy button sits on a still wrapper above the scrolling part
        const html = window.md.render(p.text)
          .replace(/<pre class="code"([^>]*)><button type="button" class="copy" title="Copy">Copy<\/button>/g, '<div class="codewrap"><button type="button" class="copy">Copy</button><pre class="code"$1>')
          .replace(/<\/code><\/pre>/g, '</code></pre></div>');
        out += `<div class="md">${html}</div>`;
      }
    }
    flush();
    return out;
  }

  function messageItems(messages) {
    const items = [];
    let lastAt = 0;
    for (const m of messages) {
      if (m.at && (!lastAt || m.at - lastAt > 20 * 60 * 1000)) {
        const html = `<div class="tsep">${esc(clock(m.at))}</div>`;
        items.push({ key: `t${m.at}`, html });
      }
      if (m.at) lastAt = m.at;
      let html = '';
      if (m.role === 'user') html = `<div class="msg user">${esc(m.text || '')}</div>`;
      else if (m.role === 'assistant') {
        const inner = renderParts(m.parts);
        if (!inner) continue;
        html = `<div class="msg assistant">${inner}</div>`;
      } else html = `<div class="msg system">${esc(m.text || '')}</div>`;
      items.push({ key: `${m.role}${m.at || ''}:${hashStr(html)}`, html });
    }
    return items;
  }

  function SessionView(id) {
    const openedAt = Date.now();
    const meta0 = (data.sessions || []).find((s) => s.id === id) || null;
    let meta = meta0;
    let tab = null; // 'chat' | 'screen'
    let chat = { size: null, messages: [], claude: meta ? !!meta.claude : true, limit: 60, loaded: false };
    let screen = { text: '', loaded: false, alive: true };
    let chatLoop = null; let screenLoop = null;
    let unwatch = () => {};
    let atBottom = true; let screenAtBottom = true;
    let askSince = 0;
    const draftKey = `draft.${id}`;

    const el = screenEl('sv', `
      <header class="topbar">
        <div class="edge"></div>
        <div class="navrow">
          <button class="back" data-act="back" aria-label="Back to sessions">${I.back}</button>
          <div class="ttl"><div class="t1"></div><div class="t2row"><span class="statepill"></span><div class="t2"></div></div></div>
          <button class="ibtn svmore" data-act="svmore" data-feat="rename move account" aria-label="More for this session">${I.more}</button>
          <button class="ibtn closewin" data-act="close" aria-label="Close this window" title="Close window">${I.close}</button>
        </div>
        <div class="seg" role="tablist" hidden><span class="thumb"></span><button role="tab" data-tab="chat" class="on">Chat</button><button role="tab" data-tab="screen">Terminal</button></div>
        <div class="askbar" hidden></div>
        <div class="offline-slot">${offlineBanner()}</div>
        <div class="hline"></div>
      </header>
      <div class="scroll chatscroll can-stale"><div class="chat"></div></div>
      <div class="scroll screenscroll can-stale" hidden><div class="termhelp"><span>The session's terminal, live, as on your computer. You rarely need it: the Chat has everything, and questions show up there as buttons.</span><button class="btn-sm" data-act="wrap"></button></div><pre class="term"></pre><div class="termnote" hidden></div></div>
      <button class="newpill" hidden>${I.down}New messages</button>
      <div class="jump" hidden><button type="button" data-act="jup" aria-label="My previous prompt">${I.up}</button><button type="button" data-act="jdn" aria-label="My next prompt">${I.dn}</button></div>
      <footer class="botbar composer">
        <div class="qcard" hidden></div>
        <div class="keys" hidden>${KEYS.map(([label, key, cls]) => `<button class="key ${cls || ''}" data-key="${key}" aria-label="${key}">${esc(label)}</button>`).join('')}</div>
        <div class="hint"></div>
        <div class="mpanel" hidden></div>
        <div class="mbar" hidden><button class="mchip" data-act="mchip" aria-expanded="false" aria-label="Model and effort"><span class="ml"></span>${I.chev}</button><button class="enh" data-act="enhance" hidden aria-label="Enhance my prompt">${I.sparkle}<span>Enhance</span></button></div>
        <div class="micline" hidden><span class="mdot"></span><span class="mtext">Listening…</span><button class="mcancel" data-act="mcancel" aria-label="Cancel recording">${I.close}</button></div>
        <div class="photos" hidden></div>
        <div class="crow-in">
          <button class="cbtn pbtn" data-act="photo" aria-label="Add photos">${I.photo}</button><input class="pfile" type="file" accept="image/*" multiple hidden>
          <textarea class="inbox" rows="1" placeholder="Message" enterkeyhint="enter" autocapitalize="sentences" aria-label="Message"></textarea>
          <button class="cbtn micbtn" data-act="mic" aria-label="Talk (Grok mic)">${I.mic}</button>
          <button class="send" data-act="send" aria-label="Send" disabled><span>${I.send}</span></button>
        </div>
      </footer>`);
    const top = $('.topbar', el);
    const seg = $('.seg', el);
    const askbar = $('.askbar', el);
    const chatScroll = $('.chatscroll', el);
    const chatEl = $('.chat', el);
    const screenScroll = $('.screenscroll', el);
    const term = $('.term', el);
    const termNote = $('.termnote', el);
    const newPill = $('.newpill', el);
    const keysEl = $('.keys', el);
    const qcard = $('.qcard', el);
    let q = null; let qSig = ''; let qLoop = null; let qBusy = false;
    let wrap = lsGet('termWrap') !== '0';
    const shown = (t) => (wrap ? String(t || '').replace(/[─━═]{12,}/g, '────────────') : t) || ' '; // wrapped long rules = noise
    const paintWrap = () => { term.textContent = shown(screen.text); term.classList.toggle('wrap', wrap); $('[data-act="wrap"]', el).textContent = wrap ? 'Wrap: on' : 'Wrap: off'; };
    const hint = $('.hint', el);
    const box = $('.inbox', el);
    const sendBtn = $('.send', el);
    const mbar = $('.mbar', el);
    const mchip = $('.mchip', el);
    const mpanel = $('.mpanel', el);
    let mOpen = false; let mBusy = false; let mPicked = null; let mSig = '';
    const enhBtn = $('.enh', el);
    let enhBusy = false;

    // ----- model and effort: a chip over the message box, its picker opens above it -----
    // (what was just picked shows at once; the sessions list says the same a moment later)
    function modelNow() {
      const fresh = mPicked && Date.now() - mPicked.at < 15000 ? mPicked : {};
      return { model: fresh.model || (meta && meta.model) || null, effort: fresh.effort || (meta && meta.effort) || null };
    }
    function paintModel() {
      const show = !!(meta && meta.claude && meta.color !== 'off');
      if (!show) mOpen = false;
      mchip.hidden = !show;
      const enhOn = has('enhance') && (enhBusy || !!box.value.trim()) && !(meta && meta.color === 'off');
      enhBtn.hidden = !enhOn;
      mbar.hidden = !show && !enhOn;
      mpanel.hidden = !mOpen;
      const now = modelNow();
      $('.ml', mchip).textContent = modelLabel(now.model, now.effort) || 'Model';
      mchip.setAttribute('aria-expanded', String(mOpen));
      const sig = mOpen ? `${now.model}|${now.effort}` : '';
      if (sig !== mSig && !mBusy) { mSig = sig; mpanel.innerHTML = mOpen ? pickerHtml(now.model, now.effort) : ''; }
    }
    mbar.addEventListener('mousedown', (e) => e.preventDefault()); // (keeps the keyboard up)
    mpanel.addEventListener('mousedown', (e) => e.preventDefault());
    mchip.addEventListener('click', () => { mOpen = !mOpen; paintModel(); });
    mpanel.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-model], button[data-effort]');
      if (!b || mBusy) return;
      const now = modelNow();
      const want = b.dataset.model ? { model: b.dataset.model } : { effort: b.dataset.effort };
      if ((want.model || now.model) === now.model && (want.effort || now.effort) === now.effort) return; // (already so)
      mBusy = true;
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b));
      b.classList.add('wait'); mpanel.classList.add('busy'); mchip.classList.add('busy');
      try {
        const r = await api('POST', `/sessions/${encodeURIComponent(id)}/model`, want, { timeout: 30000 });
        mPicked = { model: r.model || want.model || now.model, effort: r.effort || want.effort || now.effort, at: Date.now() };
        toast(`Now on ${modelLabel(mPicked.model, mPicked.effort)}`);
        setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); }, 600);
      } catch (err) { toast(err.offline ? 'Can\'t reach your Mac' : `Not changed: ${err.message}`, 'err'); }
      mBusy = false; mSig = '~';
      mpanel.classList.remove('busy'); mchip.classList.remove('busy');
      paintModel();
    });

    // ----- ✨ Enhance (the Mac's Enhance: rewrites the prompt in the box through Claude Code on the subscription) -----
    enhBtn.addEventListener('click', async () => {
      const before = box.value;
      if (enhBusy || !before.trim()) return;
      enhBusy = true; enhBtn.classList.add('busy'); enhBtn.disabled = true;
      $('span', enhBtn).textContent = 'Enhancing…';
      box.readOnly = true;
      try {
        const r = await api('POST', '/enhance', { text: before }, { timeout: 90000 });
        const t = String((r && r.text) || '').trim();
        if (!t) throw new Error('Nothing came back');
        if (box.value === before) {
          box.value = t; lsSet(draftKey, t); grow();
          toast('Prompt enhanced', '', { action: 'Undo', onAction: () => { box.value = before; lsSet(draftKey, before); grow(); } });
        }
      } catch (err) { toast(err.offline ? 'Can\'t reach your Mac' : `Couldn't enhance: ${err.message}`, 'err'); }
      enhBusy = false; box.readOnly = false; enhBtn.classList.remove('busy'); enhBtn.disabled = false;
      $('span', enhBtn).textContent = 'Enhance';
      paintModel();
    });

    // ----- header / state -----
    function paintHeader() {
      const s = meta;
      const c = s ? s.color : null;
      const cls = `topbar${c ? ` c-${c}` : ''}`;
      if (top.className !== cls) { top.className = cls; top.setAttribute('style', phase()); } // glow in step with the dots
      $('.t1', el).textContent = s ? (s.title || 'Untitled') : (Date.now() - openedAt < 20000 ? 'Starting…' : 'Session');
      $('.t2', el).innerHTML = s ? `<span class="tf">${esc(s.folder || '')}</span>${machineTag(s)}${s.account && s.account.name ? `<span class="tacct">${esc(s.account.name)}</span>` : ''}` : '';
      const pill = $('.statepill', el);
      if (s) {
        const when = s.since || s.lastOutputAt;
        const label = STATE_LABEL[c] || '';
        pill.className = `statepill ${c}`;
        pill.textContent = when && (c === 'blue' || c === 'orange' || c === 'half' || c === 'stopped') ? `${label.split(' · ')[0]} · ${age(when)}` : label;
        pill.hidden = !label;
      } else if (data.sessions && Date.now() - openedAt > 20000) {
        pill.className = 'statepill'; pill.textContent = 'Closed'; pill.hidden = false;
      } else pill.hidden = true;

      // tabs: Chat only when there's a transcript
      const hasChat = s ? !!s.claude : chat.claude;
      seg.hidden = !hasChat;
      if (!hasChat && tab !== 'screen') setTab('screen');
      $('[data-tab="screen"]', seg).textContent = 'Terminal';

      // Claude is asking: banner, and on opening go straight to the Screen
      if (s && s.ask && !q && askSince && Date.now() - askSince > 4000) {
        askbar.hidden = false;
        askbar.innerHTML = tab === 'screen'
          ? `<div class="grow">It's asking you something<small>Answer with the keys below, or type a reply</small></div>`
          : `<div class="grow">It's asking you something<small>See it on the Terminal tab</small></div><button class="btn-sm" data-act="to-screen">Open</button>`;
      } else askbar.hidden = true;
      if (s && s.ask && !qLoop) { askSince = Date.now(); qLoop = loop(fetchQuestion, 1500); }
      if (!(s && s.ask) && qLoop) { qLoop.stop(); qLoop = null; askSince = 0; showQuestion(null); }

      // composer hint
      let hc = ''; let ht = '';
      if (c === 'orange') { hc = 'orange'; ht = 'It\'s working. Your message goes in after this turn.'; }
      else if (c === 'half') { hc = 'orange'; ht = 'Done, but a background job still runs.'; }
      else if (c === 'asleep') { hc = 'asleep'; ht = 'Asleep. Sending wakes it up.'; }
      else if (c === 'off') ht = 'This session has ended.';
      else if (!s && data.sessions && Date.now() - openedAt > 20000) ht = 'This session isn\'t open any more.';
      hint.className = `hint ${hc}`;
      hint.innerHTML = ht ? `<i></i>${esc(ht)}` : '';
      paintModel();
    }
    function onSessions() {
      const s = (data.sessions || []).find((x) => x.id === id) || null;
      const was = meta;
      meta = s || (Date.now() - openedAt < 20000 ? meta : null);
      paintHeader();
      // the turn just finished: fetch the reply now
      if (was && s && was.color !== s.color) { if (chatLoop) chatLoop.kick(); if (screenLoop) screenLoop.kick(); }
    }

    // ----- tabs -----
    function setTab(t) {
      if (tab === t) return;
      tab = t;
      seg.classList.toggle('right', t === 'screen');
      $$('button[data-tab]', seg).forEach((b) => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
      chatScroll.hidden = t !== 'chat';
      screenScroll.hidden = t !== 'screen';
      if (t !== 'chat') jumpEl.hidden = true;
      keysEl.hidden = t !== 'screen';
      newPill.hidden = true;
      if (chatLoop) { chatLoop.stop(); chatLoop = null; }
      if (screenLoop) { screenLoop.stop(); screenLoop = null; }
      if (t === 'chat') { chatLoop = loop(fetchChat, 2000); requestAnimationFrame(() => { if (atBottom) chatScroll.scrollTop = chatScroll.scrollHeight; }); }
      else { screenLoop = loop(fetchScreen, 1500); requestAnimationFrame(() => { screenScroll.scrollTop = screenScroll.scrollHeight; }); }
      if (meta) paintHeader();
    }
    seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    askbar.addEventListener('click', (e) => { if (e.target.closest('[data-act="to-screen"]')) setTab('screen'); });

    // ----- chat -----
    const nearBottom = (sc) => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
    chatScroll.addEventListener('scroll', () => { atBottom = nearBottom(chatScroll); if (atBottom) newPill.hidden = true; paintJump(); }, { passive: true });

    // ----- ↑ ↓ jump between my own prompts (like the Mac's scroll-jump), shown while scrolled up -----
    const jumpEl = $('.jump', el);
    const topPad = () => parseFloat(getComputedStyle(chatScroll).paddingTop) || 0;
    function paintJump() {
      const show = tab === 'chat' && !atBottom && !!chatEl.querySelector('.msg.user');
      if (jumpEl.hidden === show) jumpEl.hidden = !show;
    }
    jumpEl.addEventListener('mousedown', (e) => e.preventDefault());
    jumpEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const tp = topPad();
      const viewTop = chatScroll.scrollTop + tp;
      const users = $$('.msg.user', chatEl).map((n) => n.closest('.it') || n);
      const pos = (n) => n.offsetTop - tp - 10;
      let target = null;
      if (b.dataset.act === 'jup') { for (const n of users) if (n.offsetTop < viewTop - 14) target = n; }
      else { for (const n of users) if (n.offsetTop > viewTop + 14) { target = n; break; } }
      if (target) chatScroll.scrollTo({ top: Math.max(0, pos(target)), behavior: 'smooth' });
      else if (b.dataset.act === 'jdn') chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
      else chatScroll.scrollTo({ top: 0, behavior: 'smooth' });
      if (target) { const m = target.querySelector('.msg.user'); if (m) { m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 900); } }
    });
    screenScroll.addEventListener('scroll', () => { screenAtBottom = nearBottom(screenScroll); }, { passive: true });
    newPill.addEventListener('click', () => { chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' }); newPill.hidden = true; });

    async function fetchChat() {
      const known = chat.size != null ? `&known=${encodeURIComponent(chat.size)}` : '';
      const r = await api('GET', `/sessions/${encodeURIComponent(id)}/chat?limit=${chat.limit}${known}`);
      if (r.unchanged) return;
      chat.size = r.size != null ? r.size : null;
      chat.claude = r.claude !== false;
      chat.messages = Array.isArray(r.messages) ? r.messages : [];
      chat.loaded = true;
      if (!chat.claude && !(meta && meta.claude)) { seg.hidden = true; setTab('screen'); return; }
      renderChat();
    }
    function pendingItems() {
      const list = pendingBySession.get(id) || [];
      const userTexts = chat.messages.filter((m) => m.role === 'user').map((m) => (m.text || '').trim());
      const now = Date.now();
      const keep = [];
      for (const p of list) {
        const seen = userTexts.filter((t) => t === p.text.trim()).length;
        if (p.status !== 'error' && seen > p.baseCount) continue; // it's in the transcript now
        if (p.status !== 'sending' && now - p.sentAt > 120000) continue;
        keep.push(p);
      }
      pendingBySession.set(id, keep);
      return keep.map((p) => {
        const st = p.status === 'sending' ? 'Sending…' : p.status === 'queued' ? 'Will send when it\'s ready' : p.status === 'error' ? 'Not sent' : 'Sent';
        return { key: `p${p.sentAt}:${p.status}`, html: `<div class="msg user pending">${esc(p.text)}</div><div class="mstatus${p.status === 'error' ? ' err' : ''}">${st}</div>` };
      });
    }
    function renderChat() {
      const items = messageItems(chat.messages).concat(pendingItems());
      if (!items.length) {
        chatEl.innerHTML = chat.loaded ? '<div class="empty"><b>No messages yet</b>Type below to start.</div>' : '';
        return;
      }
      if (chat.messages.length >= chat.limit) items.unshift({ key: `more${chat.limit}`, html: '<button class="more" data-act="more">Show earlier messages</button>' });

      const wasBottom = atBottom;
      let anchor = null; let anchorTop = 0;
      if (!wasBottom) {
        const st = chatScroll.scrollTop;
        for (const n of chatEl.children) { if (n.offsetTop + n.offsetHeight > st + 60) { anchor = n; break; } }
        if (anchor) anchorTop = anchor.getBoundingClientRect().top;
      }
      // keyed update: keep the nodes that didn't change (scroll position, open tool runs stay put)
      const old = new Map();
      for (const n of Array.from(chatEl.children)) { if (n.dataset.k) old.set(n.dataset.k, n); else n.remove(); }
      const lastOldKey = chatEl.lastElementChild ? chatEl.lastElementChild.dataset.k : null;
      const nodes = [];
      for (const it of items) {
        let n = old.get(it.key);
        if (n) old.delete(it.key);
        else {
          n = document.createElement('div');
          n.className = 'it';
          n.dataset.k = it.key;
          n.innerHTML = it.html;
        }
        nodes.push(n);
      }
      old.forEach((n) => n.remove());
      nodes.forEach((n, i) => { if (chatEl.children[i] !== n) chatEl.insertBefore(n, chatEl.children[i] || null); });
      const grew = nodes.length && nodes[nodes.length - 1].dataset.k !== lastOldKey;

      if (wasBottom) chatScroll.scrollTop = chatScroll.scrollHeight;
      else {
        if (anchor && anchor.isConnected) chatScroll.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        if (grew && lastOldKey) newPill.hidden = false;
      }
      paintJump();
    }
    chatEl.addEventListener('click', async (e) => {
      const more = e.target.closest('[data-act="more"]');
      if (more) { chat.limit += 100; chat.size = null; atBottom = false; more.textContent = 'Loading…'; try { await fetchChat(); } catch (err) { toast(err.message, 'err'); } return; }
      const cp = e.target.closest('.codewrap > .copy');
      if (cp) {
        const code = cp.parentElement.querySelector('code');
        const ok = await copyText(code ? code.textContent : '');
        cp.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { cp.textContent = 'Copy'; }, 1500);
      }
    });

    // ----- screen -----
    async function fetchScreen() {
      const r = await api('GET', `/sessions/${encodeURIComponent(id)}/screen?lines=80`);
      const text = String(r.text || '').replace(/\s+$/, '');
      screen.alive = r.alive !== false;
      term.classList.toggle('dead', !screen.alive);
      termNote.hidden = screen.alive;
      termNote.textContent = screen.alive ? '' : 'This session isn\'t running.';
      if (text !== screen.text || !screen.loaded) {
        const wasBottom = screenAtBottom || !screen.loaded;
        screen.text = text;
        term.textContent = shown(text);
        screen.loaded = true;
        if (wasBottom) screenScroll.scrollTop = screenScroll.scrollHeight;
      }
    }
    // ----- a question on screen → buttons -----
    async function fetchQuestion() {
      const r = await api('GET', `/sessions/${encodeURIComponent(id)}/screen?lines=60`);
      showQuestion(parseQuestion(r.text));
    }
    function showQuestion(nq) {
      const sig = nq ? JSON.stringify(nq) : '';
      if (sig === qSig) return;
      qSig = sig; q = nq; qBusy = false;
      qcard.hidden = !q;
      qcard.classList.remove('busy');
      if (q) {
        qcard.innerHTML = `<div class="qhead"><i></i>${meta && meta.provider === 'codex' ? 'Codex asks' : 'Claude asks'}</div>
          ${q.context ? `<pre class="qctx">${esc(q.context)}</pre>` : ''}
          <div class="qq">${esc(q.question)}</div>
          <div class="qopts">${q.options.map((o) => `<button class="qopt" data-n="${o.n}"><span class="qn">${o.n}</span><span class="ql">${esc(o.label)}${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span></button>`).join('')}</div>
          <div class="qfoot">Or type a different answer below.</div>`;
      }
      paintHeader();
      requestAnimationFrame(() => { if (tab === 'chat' && atBottom) chatScroll.scrollTop = chatScroll.scrollHeight; });
    }
    qcard.addEventListener('mousedown', (e) => { if (e.target.closest('.qopt')) e.preventDefault(); });
    qcard.addEventListener('click', async (e) => {
      const b = e.target.closest('.qopt');
      if (!b || qBusy) return;
      qBusy = true;
      qcard.classList.add('busy'); b.classList.add('picked');
      try {
        await api('POST', `/sessions/${encodeURIComponent(id)}/key`, { key: b.dataset.n });
        toast('Answered');
        setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); if (qLoop) qLoop.kick(); if (screenLoop) screenLoop.kick(); }, 400);
      } catch (err) { qBusy = false; qcard.classList.remove('busy'); b.classList.remove('picked'); toast(err.offline ? 'Can\'t reach your Mac' : `Not sent: ${err.message}`, 'err'); }
    });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="wrap"]')) { wrap = !wrap; lsSet('termWrap', wrap ? '1' : '0'); paintWrap(); } });

    keysEl.addEventListener('mousedown', (e) => { if (e.target.closest('.key')) e.preventDefault(); }); // keep the keyboard up
    keysEl.addEventListener('click', async (e) => {
      const k = e.target.closest('.key');
      if (!k) return;
      k.classList.add('hit'); setTimeout(() => k.classList.remove('hit'), 160);
      try {
        await api('POST', `/sessions/${encodeURIComponent(id)}/key`, { key: k.dataset.key });
        screenAtBottom = true;
        setTimeout(() => { if (screenLoop) screenLoop.kick(); }, 180);
        setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); }, 500);
      } catch (err) { toast(err.offline ? 'Can\'t reach your Mac' : `Key not sent: ${err.message}`, 'err'); }
    });

    // ----- composer -----
    const LINE = 22.4;
    function grow() {
      box.style.height = 'auto';
      const h = Math.min(box.scrollHeight + 1, Math.round(LINE * 6 + 20));
      box.style.height = `${Math.max(42, h)}px`;
      sendBtn.disabled = !box.value.trim() && !shots.length;
      paintModel();
    }

    // ----- photos: picked on the phone, made smaller (2048 px, JPEG), sent to the session's computer at once; the
    // message then carries them (Claude shows [Image #n]) -----
    const photosEl = $('.photos', el); const pfile = $('.pfile', el);
    let shots = []; // { key, url, state: 'up' | 'ok' | 'err', photoId, job }
    function paintShots() {
      photosEl.hidden = !shots.length;
      photosEl.innerHTML = shots.map((p) => `<div class="shot ${p.state}" data-key="${p.key}"><img src="${p.url}" alt=""><button class="shotx" data-act="shotx" aria-label="Remove photo">${I.close}</button>${p.state === 'up' ? '<i class="spin"></i>' : p.state === 'err' ? '<b>!</b>' : ''}</div>`).join('');
      grow();
    }
    function shrinkPhoto(file) {
      return new Promise((res) => {
        if (/gif/.test(file.type)) { res(file); return; }
        const url = URL.createObjectURL(file); const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          c.toBlob((b) => res(b || file), 'image/jpeg', 0.86);
        };
        img.onerror = () => { URL.revokeObjectURL(url); res(file); };
        img.src = url;
      });
    }
    function addPhotos(files) {
      for (const f of [...files].slice(0, Math.max(0, 20 - shots.length))) {
        const p = { key: Math.random().toString(36).slice(2), url: URL.createObjectURL(f), state: 'up', photoId: null };
        const name = encodeURIComponent((f.name || 'photo').replace(/\.\w+$/, ''));
        p.job = shrinkPhoto(f)
          .then((b) => api('POST', `/sessions/${encodeURIComponent(id)}/photo?name=${name}`, undefined, { raw: b, type: /^image\/(png|gif|webp|jpeg)$/.test(b.type) ? b.type : 'image/jpeg', timeout: 120000 }))
          .then((r) => { p.photoId = r.photoId; p.state = 'ok'; }, (e) => { p.state = 'err'; toast(e.offline ? 'Can\'t reach your Mac. Photo not added.' : `Photo not added: ${e.message}`, 'err'); })
          .then(paintShots);
        shots.push(p);
      }
      paintShots();
    }
    $('[data-act="photo"]', el).addEventListener('click', () => pfile.click());
    pfile.addEventListener('change', () => { if (pfile.files && pfile.files.length) addPhotos(pfile.files); pfile.value = ''; });
    photosEl.addEventListener('click', (e) => {
      const x = e.target.closest('[data-act="shotx"]'); if (!x) return;
      const k = x.closest('.shot').dataset.key; const p = shots.find((q) => q.key === k);
      shots = shots.filter((q) => q !== p); if (p) URL.revokeObjectURL(p.url);
      paintShots();
    });

    // ----- the mic: Grok Voice Transcribe, the same as F5 on the Mac. Tap to talk, tap again to stop: the words go
    // into the box where the cursor is (not sent), like F5. The sound goes to the Mac in pieces while you speak. -----
    const micBtn = $('.micbtn', el); const micline = $('.micline', el); const mtext = $('.mtext', el);
    let rec = null; // { id, ctx, stream, proc, queue, sending, tick }
    function paintMic() {
      micBtn.hidden = !!(data.hello && data.hello.mic === false);
      micBtn.classList.toggle('on', !!rec); micBtn.innerHTML = rec ? I.stop : I.mic;
      micBtn.setAttribute('aria-label', rec ? 'Stop and put the words in the box' : 'Talk (Grok mic)');
      micline.hidden = !rec;
    }
    function to16k(f32, rate) {
      const r = rate / 16000; const n = Math.floor(f32.length / r); const out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * r); const b = Math.max(a + 1, Math.min(f32.length, Math.floor((i + 1) * r)));
        let sum = 0; for (let j = a; j < b; j++) sum += f32[j];
        out[i] = Math.max(-1, Math.min(1, sum / (b - a))) * 0x7fff;
      }
      return out;
    }
    function joinPcm(parts) {
      const n = parts.reduce((a, p) => a + p.length, 0);
      const pcm = new Int16Array(n); let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
      return pcm;
    }
    const micSeq = () => !!(data.hello && (data.hello.features || []).includes('micseq'));
    async function pump(r, all) {
      if (micSeq() && !all) { // (numbered pieces: each goes at once, the Mac puts them in order)
        if (!r.queue.length || !r.id) return;
        const seq = r.seq++; const pcm = joinPcm(r.queue.splice(0));
        const x = await api('POST', `/mic/${r.id}/audio?seq=${seq}`, undefined, { raw: new Blob([pcm.buffer]), timeout: 20000 });
        if (rec === r && x && x.text && seq >= (r.shown || 0)) { r.shown = seq; mtext.textContent = x.text; }
        return;
      }
      if (r.sending) return; r.sending = true;
      try {
        while (r.queue.length && r.id) {
          const parts = r.queue.splice(0); const n = parts.reduce((a, p) => a + p.length, 0);
          const pcm = new Int16Array(n); let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
          const x = await api('POST', `/mic/${r.id}/audio`, undefined, { raw: new Blob([pcm.buffer]), timeout: 20000 });
          if (rec === r && x && x.text) mtext.textContent = x.text;
          if (!all) break;
        }
      } finally { r.sending = false; }
    }
    function micOff(r) {
      clearInterval(r.tick);
      try { if (r.proc) r.proc.disconnect(); } catch (e) {}
      try { if (r.stream) r.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { if (r.ctx) r.ctx.close(); } catch (e) {}
    }
    function micDrop(r) { if (r.id) api('DELETE', `/mic/${r.id}`).catch(() => {}); }
    async function micStart() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This phone can\'t record here.', 'err'); return; }
      const r = { id: null, ctx: new AC(), queue: [], seq: 0 }; // (the sound system is made in the tap itself: iOS wants that)
      rec = r; mtext.textContent = 'Listening…'; paintMic();
      try {
        const [stream, started] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
          api('POST', '/mic', {}),
        ]);
        r.stream = stream; r.id = started.id;
        if (rec !== r) { micOff(r); micDrop(r); return; } // (cancelled meanwhile)
        await r.ctx.resume();
        const src = r.ctx.createMediaStreamSource(stream);
        r.proc = r.ctx.createScriptProcessor(4096, 1, 1);
        r.proc.onaudioprocess = (e) => { if (rec === r) r.queue.push(to16k(e.inputBuffer.getChannelData(0), r.ctx.sampleRate)); };
        src.connect(r.proc); r.proc.connect(r.ctx.destination);
        r.tick = setInterval(() => { pump(r).catch((e) => micFail(r, e)); }, 250);
      } catch (e) { micFail(r, e); }
    }
    function micFail(r, e) {
      if (rec !== r) return;
      rec = null; micOff(r); micDrop(r); paintMic();
      toast(e && e.name === 'NotAllowedError' ? 'The mic is blocked for this app. Allow the microphone when it asks (or in Settings), then try again.'
        : e && e.offline ? 'Can\'t reach your Mac.' : `Mic: ${(e && e.message) || e}`, 'err');
    }
    async function micStop() {
      const r = rec; if (!r) return;
      rec = null; micOff(r); paintMic();
      if (!r.id) return;
      micBtn.disabled = true; box.placeholder = 'Writing it down…';
      const a = box.selectionStart != null ? box.selectionStart : box.value.length; const b = box.selectionEnd != null ? box.selectionEnd : a;
      const before = box.value.slice(0, a); const after = box.value.slice(b);
      const put = (t) => { // (t where the cursor was; called again to swap the words so far for Grok's final text)
        const ins = t ? (before && !/\s$/.test(before) ? ' ' : '') + t + (after && !/^\s/.test(after) ? ' ' : '') : '';
        box.value = before + ins + after;
        const c = (before + ins).length; try { box.setSelectionRange(c, c); } catch (e) {}
        lsSet(draftKey, box.value); grow();
        return box.value;
      };
      const heard = (mtext.textContent || '').trim();
      const shown = heard && heard !== 'Listening…' ? put(heard) : null; // (in the box at once, like F5)
      try {
        let x;
        if (micSeq()) { // (the last piece rides with the end: one trip to the Mac)
          const tail = joinPcm(r.queue.splice(0));
          x = await api('POST', `/mic/${r.id}/end?seq=${r.seq++}`, undefined, { raw: new Blob([tail.buffer]), timeout: 30000 });
        } else {
          while (r.sending) await sleep(50);
          await pump(r, true);
          x = await api('POST', `/mic/${r.id}/end`, {}, { timeout: 30000 });
        }
        const t = String((x && x.text) || '').trim();
        if (shown != null && box.value !== shown) return; // (typed in the box meanwhile: leave it)
        if (!t && shown == null) { toast('Heard nothing.'); return; }
        put(t || heard);
      } catch (e) { toast(e.offline ? `Can't reach your Mac. ${shown != null ? 'The words so far are in the box.' : 'Nothing was written down.'}` : e.message, 'err'); }
      finally { micBtn.disabled = false; box.placeholder = 'Message'; }
    }
    micBtn.addEventListener('mousedown', (e) => e.preventDefault()); // (keeps the keyboard as it is)
    micBtn.addEventListener('click', () => { if (rec) micStop(); else micStart(); });
    $('[data-act="mcancel"]', el).addEventListener('click', () => { const r = rec; if (!r) return; rec = null; micOff(r); micDrop(r); paintMic(); });
    paintMic();
    let draftTimer = null;
    box.addEventListener('input', () => {
      grow();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => lsSet(draftKey, box.value), 250);
    });
    box.addEventListener('focus', () => { if (tab === 'chat' && atBottom) setTimeout(() => { chatScroll.scrollTop = chatScroll.scrollHeight; }, 300); });
    sendBtn.addEventListener('mousedown', (e) => e.preventDefault()); // tapping Send keeps the keyboard up
    sendBtn.addEventListener('click', send);

    async function send() {
      const text = box.value;
      if (!text.trim() && !shots.length) return;
      const sent = shots; // (photos still on their way are waited for)
      if (sent.some((x) => x.state === 'up')) { sendBtn.disabled = true; toast('Sending the photos…'); await Promise.all(sent.map((x) => x.job)); }
      if (sent.some((x) => x.state === 'err')) { grow(); toast('A photo didn\'t make it. Remove it (✕) or add it again.', 'err'); return; }
      if (shots !== sent) return; // (changed meanwhile)
      const photos = sent.map((x) => x.photoId);
      shots = []; paintShots();
      box.value = '';
      grow();
      lsSet(draftKey, '');
      const userTexts = chat.messages.filter((m) => m.role === 'user').map((m) => (m.text || '').trim());
      const label = text.trim() + (photos.length ? `${text.trim() ? '\n' : ''}[${photos.length} image${photos.length > 1 ? 's' : ''}]` : ''); // (as the chat shows it)
      const p = { text: label, sentAt: Date.now(), status: 'sending', baseCount: userTexts.filter((t) => t === label).length };
      const list = pendingBySession.get(id) || [];
      list.push(p);
      pendingBySession.set(id, list);
      atBottom = true;
      if (tab === 'chat') renderChat();
      try {
        const r = await api('POST', `/sessions/${encodeURIComponent(id)}/prompt`, { text, ...(photos.length ? { photos } : {}) });
        p.status = r && r.queued ? 'queued' : 'sent';
        if (tab === 'screen') toast(p.status === 'queued' ? 'Will send when it\'s ready' : 'Sent');
        if (tab === 'chat') renderChat();
        setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); if (chatLoop) chatLoop.kick(); if (screenLoop) screenLoop.kick(); }, 700);
      } catch (e) {
        const l2 = (pendingBySession.get(id) || []).filter((x) => x !== p);
        pendingBySession.set(id, l2);
        if (!box.value.trim()) box.value = text; else if (text.trim()) box.value = `${text}\n${box.value}`;
        shots = sent.concat(shots); paintShots();
        lsSet(draftKey, box.value);
        grow();
        if (tab === 'chat') renderChat();
        toast(e.offline ? 'Can\'t reach your Mac. Your message is still in the box.' : `Not sent: ${e.message}`, 'err');
      }
    }

    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) back('#/'); });

    // ----- close the window (like its ✕ on the computer: stops it and frees its memory) -----
    let closing = false;
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-act="close"]'); if (b) closeWindow(b); });
    async function closeWindow(b0) {
      const b = b0 || $('[data-act="close"]', el);
      if (closing) return;
      const busy = meta && (meta.color === 'orange' || meta.color === 'half');
      const where = meta && meta.machineName ? ` on ${meta.machineName}` : '';
      if (!window.confirm(`Close this window${where}?${busy ? ' It is still working; closing stops it.' : ''} Its memory is freed. You can resume the chat later from its folder.`)) return;
      closing = true; b.disabled = true; b.classList.add('busy');
      try {
        await api('POST', `/sessions/${encodeURIComponent(id)}/close`, {});
        if (data.sessions) data.sessions = data.sessions.filter((x) => x.id !== id);
        lsSet(draftKey, ''); box.value = '';
        toast('Window closed. Its memory is freed.');
        if (sessionsLoop) sessionsLoop.kick();
        back('#/');
      } catch (er) {
        toast(`Couldn't close it: ${er.message}`, 'err');
        closing = false; b.disabled = false; b.classList.remove('busy');
      }
    }

    // ----- ⋯ : rename, move, account, restart, duplicate, keep awake, close (the Mac's pane menu) -----
    const sid = encodeURIComponent(id);
    const v6 = () => has('rename'); // (restart / duplicate / keep-awake came with the same server update)
    function moreHtml() {
      const s = meta || {};
      const other = s.canMove === 'pc' ? 'Windows' : 'the Mac';
      const awake = typeof s.keepAwake === 'boolean';
      let h = '';
      if (has('rename')) h += actRow('rename', I.pencil, 'Rename');
      if (has('move') && s.canMove) h += actRow('move', I.swap, `Move to ${other}`, { sub: 'Same chat, on the other computer' });
      if (has('account') && s.provider === 'claude') h += actRow('account', I.person, 'Switch account', { sub: s.account && s.account.name ? `Now on ${esc(s.account.name)}` : '', right: I.chev });
      if (v6()) {
        h += actRow('restart', I.restart, 'Restart', { sub: 'Same conversation, fresh process' });
        h += actRow('duplicate', I.copy2, 'Duplicate', { sub: 'A new, empty session of the same kind here' });
      }
      if (awake) h += `<label class="act"><span class="aico">${I.moon}</span><span class="alab">Keep awake<small>Never put to sleep when idle</small></span><input type="checkbox" class="switch" data-act="awake"${s.keepAwake ? ' checked' : ''}></label>`;
      h += actRow('sclose', I.xbig, 'Close window', { danger: true, sub: 'Frees its memory; resume later from its folder' });
      return h;
    }
    const moreSub = () => (meta ? `${esc(meta.folder || '')} · ${esc(meta.machineName || (meta.machine === 'pc' ? 'Windows' : 'Mac'))}${meta.account && meta.account.name ? ` · ${esc(meta.account.name)}` : ''}` : '');
    function accountRows(u) {
      const p = u && (u.providers || []).find((x) => x.provider === 'claude');
      if (!p || !p.accounts || !p.accounts.length) return '<div class="sempty">No Claude accounts found.</div>';
      const cur = meta && meta.account ? meta.account.id : null;
      const isCur = (a) => !!cur && [a.id].concat(a.alsoIds || []).includes(cur);
      return p.accounts.map((a) => {
        const w5 = (a.windows || []).find((w) => w.kind === 'session');
        const wk = (a.windows || []).find((w) => w.kind === 'week');
        const left = (w) => (w && w.usedPercent != null ? `${Math.max(0, Math.round(100 - w.usedPercent))}%` : '–');
        const spent = !!a.spent || (w5 && w5.usedPercent >= 100) || (wk && wk.usedPercent >= 100);
        const sub = a.skipped ? 'Skipped' : (w5 || wk) ? `5-hour ${left(w5)} left · Week ${left(wk)} left${spent ? ' · used up' : ''}` : (spent ? 'Used up' : 'No numbers yet');
        return `<button type="button" class="act acct${a.skipped ? ' dim' : ''}${spent && !a.skipped ? ' spent' : ''}" data-acct="${esc(a.id)}"${a.skipped ? ' disabled' : ''}>
          <span class="alab">${esc(a.name)}${a.plan ? ` <span class="plan">${esc(a.plan)}</span>` : ''}<small>${sub}</small></span>${isCur(a) ? `<span class="tick">${I.check}</span>` : ''}</button>`;
      }).join('');
    }
    function openMore() {
      let busy = false;
      const main = (sh) => sh.set(meta ? meta.title || 'Session' : 'Session', moreHtml(), moreSub());
      const sh = sheet({
        title: meta ? meta.title || 'Session' : 'Session', sub: moreSub(), html: moreHtml(),
        async onClick(e) {
          if (e.target.closest('[data-act="sback"]')) { main(sh); return; }
          const b = e.target.closest('button[data-act], button[data-acct]');
          if (!b || busy) return;
          const act = b.dataset.act;
          const run = async (fn) => { busy = true; b.classList.add('busy'); try { await fn(); } catch (err) { toast(err.offline ? 'Can\'t reach your Mac' : err.message, 'err'); } busy = false; b.classList.remove('busy'); };
          if (act === 'rename') {
            sh.set('Rename', `<form class="rename"><input class="rin" type="text" maxlength="120" value="${esc(meta ? meta.title || '' : '')}" aria-label="New name" enterkeyhint="done" autocomplete="off"><button type="submit" class="btn primary">Save</button></form>`, '', true);
            const f = $('form', sh.body); const inp = $('.rin', sh.body);
            setTimeout(() => { inp.focus(); inp.select(); }, 60);
            f.addEventListener('submit', async (ev) => {
              ev.preventDefault();
              const title = inp.value.trim();
              if (!title) { inp.focus(); return; }
              await run(async () => {
                await api('POST', `/sessions/${sid}/rename`, { title });
                if (meta) meta.title = title;
                paintHeader(); sh.close(); toast('Renamed');
                if (sessionsLoop) sessionsLoop.kick();
              });
            });
            return;
          }
          if (act === 'account') {
            sh.set('Switch account', '<div class="sempty"><span class="spin"></span></div>', 'Claude accounts and what they have left', true);
            try {
              const u = await api('GET', '/usage'); data.usage = u;
              if (sh.body.isConnected) sh.set('Switch account', accountRows(u), 'Claude accounts and what they have left', true);
            } catch (err) { if (sh.body.isConnected) sh.set('Switch account', `<div class="sempty">${esc(err.message)}</div>`, '', true); }
            return;
          }
          if (b.dataset.acct) {
            const picked = ((data.usage && data.usage.providers) || []).flatMap((p) => p.accounts || []).find((x) => x.id === b.dataset.acct);
            if (meta && meta.account && picked && [picked.id].concat(picked.alsoIds || []).includes(meta.account.id)) { sh.close(); return; }
            await run(async () => {
              await api('POST', `/sessions/${sid}/account`, { accountId: b.dataset.acct }, { timeout: 60000 });
              const a = ((data.usage && data.usage.providers) || []).flatMap((p) => p.accounts || []).find((x) => x.id === b.dataset.acct);
              if (meta && a) meta.account = { id: a.id, name: a.name };
              paintHeader(); sh.close(); toast(`Switching to ${a ? a.name : 'that account'}… it continues where it was.`);
              setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); }, 1200);
            });
            return;
          }
          if (act === 'move') {
            const to = meta && meta.canMove;
            if (!to) return;
            await run(async () => {
              await api('POST', `/sessions/${sid}/move`, { to }, { timeout: 60000 });
              sh.close(); toast(`Moving to ${to === 'pc' ? 'Windows' : 'the Mac'}… find it in the list in a moment.`);
              if (sessionsLoop) sessionsLoop.kick();
              back('#/');
            });
            return;
          }
          if (act === 'restart') {
            const working = meta && (meta.color === 'orange' || meta.color === 'half');
            if (working && !window.confirm('It is still working. Restart anyway? The turn in progress stops.')) return;
            await run(async () => {
              await api('POST', `/sessions/${sid}/restart`, {}, { timeout: 60000 });
              sh.close(); toast('Restarting… same conversation.');
              setTimeout(() => { if (sessionsLoop) sessionsLoop.kick(); if (chatLoop) chatLoop.kick(); }, 1500);
            });
            return;
          }
          if (act === 'duplicate') {
            await run(async () => {
              const r = await api('POST', `/sessions/${sid}/duplicate`, {}, { timeout: 60000 });
              sh.close(); toast('Duplicated');
              if (sessionsLoop) sessionsLoop.kick();
              if (r && r.sessionId) go(`#/s/${encodeURIComponent(r.sessionId)}`, 'push');
            });
            return;
          }
          if (act === 'sclose') { sh.close(); closeWindow(); }
        },
        async onChange(e) {
          const sw = e.target.closest('[data-act="awake"]');
          if (!sw) return;
          sw.disabled = true;
          try {
            await api('POST', `/sessions/${sid}/keep-awake`, { on: sw.checked });
            if (meta) meta.keepAwake = sw.checked;
            toast(sw.checked ? 'Kept awake' : 'Sleeps when idle again');
          } catch (err) { sw.checked = !sw.checked; toast(err.offline ? 'Can\'t reach your Mac' : err.message, 'err'); }
          sw.disabled = false;
        },
      });
    }
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="svmore"]')) openMore(); });

    return {
      el,
      onViewport() { if (tab === 'chat' && atBottom) chatScroll.scrollTop = chatScroll.scrollHeight; },
      mounted() {
        unwatch = watchBars(el);
        box.value = lsGet(draftKey) || '';
        grow();
        subs.add(onSessions);
        setTab(meta && !meta.claude ? 'screen' : 'chat');
        paintWrap();
        paintHeader();
        if (sessionsLoop) sessionsLoop.kick();
      },
      destroy() {
        subs.delete(onSessions);
        if (chatLoop) chatLoop.stop();
        if (screenLoop) screenLoop.stop();
        if (qLoop) qLoop.stop();
        clearTimeout(draftTimer);
        lsSet(draftKey, box.value);
        if (rec) { const r = rec; rec = null; micOff(r); micDrop(r); }
        for (const p of shots) URL.revokeObjectURL(p.url);
        unwatch();
      },
    };
  }


  // ======================================================================================
  // Folders
  // ======================================================================================
  function FoldersView() {
    const el = screenEl('folders', `
      <header class="topbar">
        <div class="brandrow"><h1>Folders</h1>${connPill()}</div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll can-stale"><div class="body"></div></div>
      ${tabbar('folders')}`);
    const body = $('.body', el);
    let unwatch = () => {};
    let fl = null;
    function render() {
      if (!data.folders) { body.innerHTML = '<div class="glabel">&nbsp;</div><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; return; }
      if (!data.folders.length) { body.innerHTML = '<div class="empty"><b>No folders yet</b>Folders you use in FoxyMind show up here.</div>'; return; }
      const row = (f) => `<a class="frow" href="#/f/${encodeURIComponent(f.id)}">
        <span class="ficon">${I.folder}</span>
        <span class="smain"><span class="stitle">${esc(f.name)}</span><span class="ssub"><span class="mtag ${f.machine === 'pc' ? 'pc' : ''}">${esc(f.machineName || (f.machine === 'pc' ? 'Windows' : 'Mac'))}</span><span class="fo">${f.sessions ? `${f.sessions} session${f.sessions === 1 ? '' : 's'}` : 'No open sessions'}</span></span></span>
        <span class="cnts">${f.blue ? `<span class="cnt blue"><i></i>${f.blue}</span>` : ''}${f.orange ? `<span class="cnt orange"><i></i>${f.orange}</span>` : ''}</span>${I.chev}</a>`;
      body.innerHTML = `<div class="glabel">${data.folders.length} folder${data.folders.length === 1 ? '' : 's'}</div><div class="list">${data.folders.map(row).join('')}</div>`;
    }
    async function fetchFolders() {
      const r = await api('GET', '/folders');
      data.folders = Array.isArray(r.folders) ? r.folders : [];
      render();
    }
    body.addEventListener('click', (e) => { const a = e.target.closest('a.frow'); if (a) { e.preventDefault(); go(a.getAttribute('href'), 'push'); } });
    return {
      el,
      mounted() { unwatch = watchBars(el); render(); fl = loop(fetchFolders, 10000); },
      destroy() { if (fl) fl.stop(); unwatch(); },
    };
  }

  function FolderView(fid) {
    const f0 = (data.folders || []).find((f) => f.id === fid);
    const el = screenEl('folder', `
      <header class="topbar">
        <div class="navrow">
          <button class="back" data-act="back" aria-label="Back to folders">${I.back}</button>
          <div class="ttl"><div class="t1">${esc(f0 ? f0.name : 'Folder')}</div><div class="t2">${f0 ? esc(f0.machineName || '') : ''}</div></div>
          ${connPill()}
        </div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll can-stale">
        <div class="fhead"><button class="btn primary" data-act="new">${I.plus}New Claude chat</button></div>
        <div class="fpick">${pickerHtml(NEW_CHAT.model, NEW_CHAT.effort)}</div>
        <div class="kinds" data-feat="newkinds"><div class="mlab">Or start</div><div class="krow">
          <button type="button" class="kbtn" data-kind="codex">${I.k_codex}<span>Codex</span></button>
          <button type="button" class="kbtn" data-kind="grok">${I.k_grok}<span>Grok</span></button>
          <button type="button" class="kbtn" data-kind="shell">${I.k_term}<span>Terminal</span></button>
        </div></div>
        <p class="fpath">${f0 && f0.path ? esc(f0.path) : ''}</p>
        <div class="chats"></div>
      </div>
      ${tabbar('folders')}`);
    const chatsEl = $('.chats', el);
    const newBtn = $('[data-act="new"]', el);
    let unwatch = () => {};
    let busy = false;
    let chats = null;
    const start = { ...NEW_CHAT }; // what the new chat opens on (Opus 5.5 at medium each time, unless picked here)

    function render(r) {
      if (!r) { chatsEl.innerHTML = '<div class="glabel">Resume a chat</div><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; return; }
      const missing = Array.isArray(r.missing) && r.missing.length
        ? `<p class="note">${I.warn}${esc(r.missing.join(' and '))} didn't answer, so ${r.missing.length > 1 ? 'their' : 'its'} chats aren't listed.</p>` : '';
      const list = r.chats || [];
      if (!list.length) { chatsEl.innerHTML = `<div class="glabel">Resume a chat</div>${missing}<div class="empty" style="margin-top:30px">No earlier chats in this folder.</div>`; return; }
      const row = (c) => {
        const title = c.title || c.prompt || 'Untitled chat';
        const last = c.title && c.prompt && c.prompt !== c.title ? `<span class="last">Last: ${esc(c.prompt)}</span>` : '';
        return `<button class="crow" style="width:100%;text-align:left" data-chat="${esc(c.id)}" data-machine="${esc(c.machine || '')}" ${c.pane ? `data-pane="${esc(c.pane)}"` : ''}>
          <span class="smain"><span class="stitle">${esc(title)}</span>${last}
          <span class="meta">${c.mtime ? `<span>${esc(age(c.mtime))} ago</span>` : ''}${c.size ? `<span>· ${esc(bytes(c.size))}</span>` : ''}<span class="mtag ${c.machine === 'pc' ? 'pc' : ''}">${esc(c.machineName || (c.machine === 'pc' ? 'Windows' : 'Mac'))}</span>${c.pane ? '<span class="openpill">Open</span>' : ''}</span></span>${I.chev}</button>`;
      };
      chatsEl.innerHTML = `<div class="glabel">Resume a chat <span class="n">· ${list.length}</span></div>${missing}<div class="list">${list.map(row).join('')}</div>`;
    }

    async function load() {
      try {
        if (!data.folders) { const fr = await api('GET', '/folders'); data.folders = fr.folders || []; }
        const f = data.folders.find((x) => x.id === fid);
        if (f) {
          $('.t1', el).textContent = f.name;
          $('.t2', el).textContent = `${f.machineName || ''}${f.sessions ? ` · ${f.sessions} open` : ''}`;
          $('.fpath', el).textContent = f.path || '';
        }
        chats = await api('GET', `/folders/${encodeURIComponent(fid)}/chats`);
        render(chats);
      } catch (e) {
        if (!chats) chatsEl.innerHTML = `<div class="empty"><b>Couldn't load chats</b>${esc(e.message)}<button class="btn secondary" data-act="reload">Try again</button></div>`;
      }
    }

    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="back"]')) { if (prevHash === '#/folders') back('#/folders'); else go('#/folders', 'pop'); return; }
      if (e.target.closest('[data-act="reload"]')) { render(null); load(); return; }
      if (busy) return;
      const pk = e.target.closest('.fpick button');
      if (pk) {
        if (pk.dataset.model) start.model = pk.dataset.model; else start.effort = pk.dataset.effort;
        $('.fpick', el).innerHTML = pickerHtml(start.model, start.effort);
        return;
      }
      const kb = e.target.closest('.kbtn');
      if (kb) {
        busy = true;
        const label = $('span', kb).textContent;
        kb.classList.add('busy'); $('span', kb).textContent = 'Starting…';
        try {
          const r = await api('POST', `/folders/${encodeURIComponent(fid)}/new`, { provider: kb.dataset.kind }, { timeout: 60000 });
          go(`#/s/${encodeURIComponent(r.sessionId)}`, 'push');
        } catch (err) {
          toast(err.offline ? 'Can\'t reach your Mac' : `Couldn't start: ${err.message}`, 'err');
          kb.classList.remove('busy'); $('span', kb).textContent = label;
        }
        busy = false;
        return;
      }
      if (e.target.closest('[data-act="new"]')) {
        busy = true;
        newBtn.innerHTML = '<span class="spin"></span>Starting…';
        try {
          const r = await api('POST', `/folders/${encodeURIComponent(fid)}/new`, { provider: 'claude', model: start.model, effort: start.effort }, { timeout: 60000 });
          go(`#/s/${encodeURIComponent(r.sessionId)}`, 'push');
        } catch (err) {
          toast(err.offline ? 'Can\'t reach your Mac' : `Couldn't start: ${err.message}`, 'err');
          newBtn.innerHTML = `${I.plus}New Claude chat`;
        }
        busy = false;
        return;
      }
      const row = e.target.closest('.crow');
      if (!row) return;
      if (row.dataset.pane) { go(`#/s/${encodeURIComponent(row.dataset.pane)}`, 'push'); return; }
      busy = true;
      row.style.opacity = '.55';
      try {
        const r = await api('POST', `/folders/${encodeURIComponent(fid)}/resume`, { chatId: row.dataset.chat, machine: row.dataset.machine || undefined });
        go(`#/s/${encodeURIComponent(r.sessionId)}`, 'push');
      } catch (err) {
        toast(err.offline ? 'Can\'t reach your Mac' : `Couldn't resume: ${err.message}`, 'err');
        row.style.opacity = '';
      }
      busy = false;
    });

    return {
      el,
      mounted() { unwatch = watchBars(el); render(null); load(); },
      destroy() { unwatch(); },
    };
  }

  // ======================================================================================
  // Usage: the Mac's Usage panel, one hairline row per account
  // ======================================================================================
  function ubar(w, short) {
    const used = w && w.usedPercent != null ? Math.max(0, Math.min(100, Number(w.usedPercent))) : null;
    const left = used == null ? null : Math.round(100 - used);
    const lvl = left == null ? '' : left <= 0 ? 'zero' : left < 10 ? 'low' : left < 25 ? 'mid' : '';
    const reset = w && w.resetsAt ? `resets ${until(w.resetsAt)}` : '';
    const val = left == null ? 'Not known' : `${left}% left${reset ? ` · ${reset}` : ''}`;
    return `<div class="ubar ${lvl}"><span class="ul">${esc(short || (w && w.label) || '')}</span><span class="track"><i style="transform:scaleX(${left == null ? 0 : left / 100})"></i></span><span class="uv">${esc(val)}</span></div>`;
  }
  function UsageView() {
    const el = screenEl('usage', `
      <header class="topbar">
        <div class="brandrow"><h1>Usage</h1><button class="ibtn" data-act="urefresh" aria-label="Refresh usage">${I.refresh}</button></div>
        <div class="subrow"><span class="uat"></span>${connPill()}</div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll can-stale"><div class="body"></div></div>
      ${tabbar('usage')}`);
    const body = $('.body', el);
    const scroll = $('.scroll', el);
    const atEl = $('.uat', el);
    const open = new Set();
    let unwatch = () => {}; let ul = null; let refreshing = false; let err = null;

    function row(a, p) {
      const ws = a.windows || [];
      const w5 = ws.find((w) => w.kind === 'session');
      const wk = ws.find((w) => w.kind === 'week');
      const spent = !!a.spent || ws.some((w) => w.usedPercent >= 100);
      const isOpen = open.has(a.id);
      const tags = [];
      if (a.skipped) tags.push('<span class="utag skip">Skipped</span>');
      else {
        if (a.inUse) tags.push(`<span class="utag use">in use · ${a.inUse}</span>`);
        if (a.usedFirst) tags.push('<span class="utag first">used first</span>');
        else if (a.next && !a.inUse) tags.push('<span class="utag nxt">next</span>');
        if (spent) tags.push('<span class="utag spent">used up</span>');
      }
      if (a.error) tags.push('<span class="utag errt">error</span>');
      const bars = isOpen ? ws.map((w) => ubar(w, w.label)).join('') : `${w5 ? ubar(w5, '5-hour') : ''}${wk ? ubar(wk, 'Week') : ''}`;
      const more = isOpen ? `<div class="umore">
          ${a.error ? `<p class="uerr">${esc(a.error)}</p>` : ''}
          <div class="ufoot"><span>${a.updatedAt ? `Updated ${esc(age(a.updatedAt))} ago` : ''}${a.inUse ? ` · ${a.inUse} open session${a.inUse === 1 ? '' : 's'}` : ''}</span>
          <button class="btn-sm${a.skipped ? ' on' : ''}" data-skip="${esc(a.id)}" data-to="${a.skipped ? '0' : '1'}" data-name="${esc(a.name)}">${a.skipped ? 'Use again' : 'Skip'}</button></div></div>` : '';
      return `<div class="urow${a.skipped ? ' skipped' : ''}${isOpen ? ' open' : ''}" data-acc="${esc(a.id)}">
        <button type="button" class="uhead" data-act="utoggle" aria-expanded="${isOpen}"><span class="uname">${esc(a.name)}${a.plan ? `<span class="plan">${esc(a.plan)}</span>` : ''}</span><span class="utags">${tags.join('')}</span>${I.chev}</button>
        ${bars ? `<div class="ubars">${bars}</div>` : ''}${more}</div>`;
    }
    function render() {
      const u = data.usage;
      atEl.textContent = refreshing ? 'Refreshing…' : u && u.at ? `Updated ${Date.now() - u.at < 60000 ? 'just now' : `${age(u.at)} ago`}` : '';
      if (!u) {
        body.innerHTML = err ? `<div class="empty"><b>Couldn't load usage</b>${esc(err)}<button class="btn secondary" data-act="urefresh">Try again</button></div>` : '<div class="glabel">&nbsp;</div><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
        return;
      }
      const ps = (u.providers || []).filter((p) => p.accounts && p.accounts.length);
      if (!ps.length) { body.innerHTML = '<div class="empty"><b>No accounts</b>Sign in to Claude, Codex or Grok in FoxyMind on your Mac.</div>'; return; }
      body.innerHTML = ps.map((p) => `<div class="glabel">${esc(p.name || p.provider)} <span class="n">· ${p.accounts.length}</span></div><div class="list ulist">${p.accounts.map((a) => row(a, p)).join('')}</div>`).join('')
        + '<p class="gfoot">Tap an account for every limit and to skip it. Skipped accounts are never used; their sessions move to others.</p>';
    }
    async function load() {
      try { data.usage = await api('GET', '/usage'); err = null; } catch (e) { err = e.message; }
      render();
    }
    async function refresh() {
      if (refreshing) return;
      refreshing = true; render();
      const b = $('[data-act="urefresh"]', el); if (b) b.classList.add('spinning');
      try { data.usage = await api('POST', '/usage/refresh', {}, { timeout: 30000 }); err = null; } catch (e) { toast(e.offline ? 'Can\'t reach your Mac' : `Couldn't refresh: ${e.message}`, 'err'); }
      refreshing = false; if (b) b.classList.remove('spinning');
      render();
    }
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-act="urefresh"]')) { refresh(); return; }
      const sk = e.target.closest('[data-skip]');
      if (sk) {
        const skip = sk.dataset.to === '1';
        if (skip && !window.confirm(`Skip ${sk.dataset.name}? FoxyMind stops using it and moves its sessions to other accounts.`)) return;
        sk.disabled = true;
        try {
          await api('POST', `/accounts/${encodeURIComponent(sk.dataset.skip)}/skip`, { skip });
          const a = ((data.usage && data.usage.providers) || []).flatMap((p) => p.accounts || []).find((x) => x.id === sk.dataset.skip);
          if (a) a.skipped = skip;
          toast(skip ? `${sk.dataset.name} is skipped` : `${sk.dataset.name} is used again`);
          render();
          setTimeout(load, 1500);
        } catch (er) { sk.disabled = false; toast(er.offline ? 'Can\'t reach your Mac' : er.message, 'err'); }
        return;
      }
      const h = e.target.closest('[data-act="utoggle"]');
      if (h) { const id = h.closest('.urow').dataset.acc; if (open.has(id)) open.delete(id); else open.add(id); render(); }
    });
    let pullStart = null;
    scroll.addEventListener('touchstart', (e) => { pullStart = scroll.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    scroll.addEventListener('touchend', (e) => {
      if (pullStart == null) return;
      const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : 0) - pullStart;
      pullStart = null;
      if (dy > 90) refresh();
    }, { passive: true });
    return {
      el,
      mounted() { unwatch = watchBars(el); render(); ul = loop(load, 60000); },
      destroy() { if (ul) ul.stop(); unwatch(); },
    };
  }

  // ======================================================================================
  // Settings
  // ======================================================================================
  function urlBase64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function SettingsView() {
    const el = screenEl('settings', `
      <header class="topbar">
        <div class="brandrow"><h1>Settings</h1>${connPill()}</div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll"><div class="body"></div></div>
      ${tabbar('settings')}`);
    const body = $('.body', el);
    let unwatch = () => {};
    let localSub = null;
    let busy = '';

    function notifSection() {
      const h = data.hello;
      const dev = (h && h.device) || {};
      const nt = dev.notify || { blue: true, ask: true, away: false };
      let inner = '';
      let foot = 'Get a notification when a session turns blue and needs you.';
      if (isIOS && !isStandalone()) {
        inner = `<div class="ltext">Your iPhone only sends notifications to the <b>Home Screen app</b>. Open FoxyMind from your Home Screen to turn them on.</div>`;
      } else if (!pushSupported()) {
        inner = '<div class="ltext">This browser can\'t show notifications.</div>';
      } else if (Notification.permission === 'denied') {
        inner = '<div class="ltext">Notifications are blocked. Turn them on in <b>Settings → Notifications → FoxyMind</b>, then come back.</div>';
      } else {
        const on = !!(dev.push && localSub && Notification.permission === 'granted');
        if (!on) {
          inner = `<button class="lrow btnrow-l" style="width:100%" data-act="push-on">${busy === 'on' ? '<span class="spin" style="width:16px;height:16px;border-width:2px"></span>' : ''}Turn on notifications</button>`;
        } else {
          const sw = (k, label, sub) => `<label class="lrow"><span class="grow">${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" class="switch" data-nt="${k}"${nt[k] ? ' checked' : ''}></label>`;
          inner = sw('blue', 'A session is waiting for me')
            + sw('ask', 'Claude asks me something')
            + sw('away', 'Only when I\'m away from the Mac', 'Quiet while you\'re using the Mac')
            + `<button class="lrow btnrow-l" style="width:100%" data-act="push-test">${busy === 'test' ? 'Sending…' : 'Send a test'}</button>`
            + `<button class="lrow danger" style="width:100%" data-act="push-off">Turn off on this phone</button>`;
          foot = 'One notification per session; tap it to open that session.';
        }
      }
      return `<div class="glabel">Notifications</div><div class="list">${inner}</div><p class="gfoot">${foot}</p>`;
    }
    function connSection() {
      const h = data.hello;
      let host = '';
      try { host = currentBase() ? new URL(currentBase()).host : ''; } catch (e) { host = currentBase() || ''; }
      const machines = (h && Array.isArray(h.machines)) ? h.machines : [];
      const state = conn.state === 'online' ? 'Online' : conn.state === 'offline' ? 'Offline' : conn.state === 'reconnecting' ? 'Reconnecting…' : 'Checking…';
      // the Mac's row shows this phone's link to it; other computers show what the Mac says about them
      const isMac = (m) => m.id === 'mac' || m.name === (store.macName || 'Mac');
      // (with the Computers section, this one only shows the phone's own link to the Mac)
      const rows = machines.length && !has('machines') ? machines : [{ id: 'mac', name: store.macName || 'Mac' }];
      return `<div class="glabel">Connection</div><div class="list">
        ${rows.map((m) => {
          const on = isMac(m) ? conn.state === 'online' : !!m.online;
          const val = isMac(m) ? state : (m.online ? 'Online' : 'Off or asleep');
          return `<div class="lrow"><span class="mdot${on ? ' on' : ''}"></span><span class="grow">${esc(m.name)}</span><span class="val">${val}</span></div>`;
        }).join('')}
        <div class="lrow"><span class="grow">Last seen</span><span class="val">${store.lastSeen ? (Date.now() - store.lastSeen < 10000 ? 'Just now' : `${age(store.lastSeen)} ago`) : 'Never'}</span></div>
        <div class="lrow"><span class="grow">Address</span><span class="val" style="font-size:13px">${esc(host || 'Not found yet')}</span></div>
        ${h && h.build ? `<div class="lrow"><span class="grow">FoxyMind build</span><span class="val">${esc(h.build)}</span></div>` : ''}
      </div>`;
    }
    function computersSection() {
      if (!has('machines')) return '';
      const ms = data.machines ? data.machines.machines : null;
      if (!ms) return '<div class="glabel">Computers</div><div class="list"><div class="skel"></div><div class="skel"></div></div>';
      const rows = ms.map((m) => {
        const st = machineState(m);
        const bits = [st.word];
        if (m.online && !m.asleep) {
          if (m.cpu != null) bits.push(`CPU ${Math.round(m.cpu)}%`);
          if (m.freeGB != null) bits.push(`${Number(m.freeGB).toFixed(1)} GB free`);
        }
        if (m.note && !(m.online && !m.asleep)) bits.splice(0, 1, m.note.replace(/\.$/, ''));
        const n = m.sessions != null ? `${m.sessions} session${m.sessions === 1 ? '' : 's'}` : '';
        const wake = m.id === 'pc' && (m.asleep || !m.online) ? '<button class="btn-sm" data-act="pcwake">Wake</button>' : '';
        return `<div class="lrow"><span class="mdot ${st.cls}"></span><span class="grow">${esc(m.name || (m.id === 'pc' ? 'Windows' : 'Mac'))}<small>${esc(bits.join(' · '))}</small></span>${wake || `<span class="val">${esc(n)}</span>`}</div>`;
      }).join('');
      return `<div class="glabel">Computers</div>${movingLine()}<div class="list">${rows}

        <div class="lrow everyrow"><span class="grow">Everything on</span>${everythingSeg()}</div></div>
        <p class="gfoot">Everything on moves every session to one computer and keeps new ones there.</p>`;
    }
    function render() {
      body.innerHTML = `${notifSection()}${computersSection()}${connSection()}
        <div class="glabel">This phone</div>
        <div class="list"><button class="lrow danger" style="width:100%" data-act="unpair">Unpair this phone</button></div>
        <p class="gfoot">Unpairing removes this phone from FoxyMind. You'll need a new pair link to use it again.</p>
        <p class="ver">FoxyMind Phone ${APP_VERSION}${store.devBase ? ' · dev server' : ''}</p>`;
    }
    async function refresh() {
      try {
        setHello(await api('GET', '/hello'));
        if (machinesLoop) machinesLoop.kick();
      } catch (e) { /* offline: show what we have */ }
      if (pushSupported()) {
        try { const reg = await navigator.serviceWorker.getRegistration(); localSub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null; } catch (e) { localSub = null; }
      }
      render();
    }

    async function pushOn() {
      // the permission prompt must come straight from the tap (iOS)
      let perm;
      try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
      if (perm !== 'granted') { toast(perm === 'denied' ? 'Notifications are blocked for FoxyMind' : 'Notifications not allowed', 'err'); render(); return; }
      busy = 'on'; render();
      try {
        const h = data.hello || await api('GET', '/hello');
        data.hello = h;
        if (!h.vapidPublicKey) throw new Error('The Mac has no notification key yet');
        const reg = await navigator.serviceWorker.ready;
        const key = urlBase64ToUint8Array(h.vapidPublicKey);
        let sub = await reg.pushManager.getSubscription();
        if (sub && sub.options && sub.options.applicationServerKey) {
          const cur = new Uint8Array(sub.options.applicationServerKey);
          if (cur.length !== key.length || cur.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await api('POST', '/push', { subscription: sub.toJSON() });
        localSub = sub;
        if (data.hello.device) data.hello.device.push = true; else data.hello.device = { push: true, notify: { blue: true, ask: true, away: false } };
        toast('Notifications are on');
      } catch (e) {
        toast(`Couldn't turn on notifications: ${e.message}`, 'err');
      }
      busy = ''; render();
    }

    let everyBusy = false;
    body.addEventListener('click', async (e) => {
      const ev = e.target.closest('[data-every]');
      if (ev && !everyBusy) {
        everyBusy = true; busy = 'every';
        $$('[data-every]', body).forEach((x) => x.classList.toggle('on', x === ev));
        await setEverything(ev.dataset.every, () => { everyBusy = false; busy = ''; render(); });
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'pcwake') { wakePc(b); return; }
      if (act === 'mvstop') { stopMoving(b); return; }
      if (act === 'push-on') { pushOn(); return; }
      if (act === 'push-test') {
        busy = 'test'; render();
        try { const r = await api('POST', '/push/test'); toast(r && r.sent ? 'Test sent. It should arrive in a moment.' : 'The Mac has no phone to send to. Turn notifications off and on again.', r && r.sent ? '' : 'err'); } catch (err) { toast(`Test failed: ${err.message}`, 'err'); }
        busy = ''; render();
        return;
      }
      if (act === 'push-off') {
        try {
          await api('DELETE', '/push');
          if (localSub) { try { await localSub.unsubscribe(); } catch (err) { /* ignore */ } }
          localSub = null;
          if (data.hello && data.hello.device) data.hello.device.push = false;
          toast('Notifications are off on this phone');
        } catch (err) { toast(`Couldn't turn off: ${err.message}`, 'err'); }
        render();
        return;
      }
      if (act === 'unpair') {
        if (!window.confirm('Unpair this phone? You\'ll need a new pair link to use it again.')) return;
        try { await api('POST', '/unpair'); } catch (err) { if (!err.offline && err.status !== 401) { toast(`Couldn't unpair: ${err.message}`, 'err'); return; } }
        try { const reg = await navigator.serviceWorker.getRegistration(); const s = reg && await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (err) { /* ignore */ }
        stopGlobal();
        const devBase = store.devBase; const ntfy = store.ntfy;
        store = {};
        if (devBase) store.devBase = devBase;
        if (ntfy) store.ntfy = ntfy;
        try { Object.keys(localStorage).filter((k) => k.startsWith(LS)).forEach((k) => localStorage.removeItem(k)); } catch (err) { /* ignore */ }
        save();
        toast('This phone is unpaired');
        go('#/');
      }
    });
    body.addEventListener('change', async (e) => {
      const s = e.target.closest('[data-nt]');
      if (!s) return;
      const nt = Object.assign({ blue: true, ask: true, away: false }, (data.hello && data.hello.device && data.hello.device.notify) || {});
      nt[s.dataset.nt] = s.checked;
      s.disabled = true;
      try {
        const r = await api('POST', '/notify', nt);
        if (data.hello && data.hello.device) data.hello.device.notify = (r && r.notify) || nt;
      } catch (err) { s.checked = !s.checked; toast(`Couldn't save: ${err.message}`, 'err'); }
      s.disabled = false;
    });

    const tick = setInterval(() => { if (!busy && !body.contains(document.activeElement)) render(); }, 10000);
    const onData = (what) => { if (what === 'machines' && !busy) render(); };
    return {
      el,
      mounted() { unwatch = watchBars(el); render(); refresh(); subs.add(onData); },
      onHello() { if (!busy) render(); },
      destroy() { clearInterval(tick); unwatch(); subs.delete(onData); },

    };
  }

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* fine without it */ });
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'open') go(d.sessionId ? `#/s/${encodeURIComponent(d.sessionId)}` : '#/', 'push');
    });
  }

  fitViewport();
  route();
  window.__fm = { store: () => store, data, conn }; // (for debugging from the console)
})();
