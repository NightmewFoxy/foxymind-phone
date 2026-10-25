// FoxyMind Phone — see and continue FoxyMind sessions from the iPhone.
// Plain JS, no build step. Talks to <base>/phone/api (see phone/API.md); finds <base> on ntfy.sh.
// Two ways in (v8): the Mac's address and Windows' are both on ntfy; the app uses the Mac when it answers (it shows
// both computers' sessions) and Windows when it doesn't (Windows' own sessions), and goes back by itself.
(() => {
  'use strict';

  const APP_VERSION = '11';
  const LS = 'foxyPhone';
  const BREATH = 2400; // ms, the desktop's glow breath
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MIC_TAIL_MS = 1000; // (the mic keeps listening up to this long after the stop tap: browsers hand sound over late)
  const MIC_QUIET_MS = 300; // (… but stops once this much quiet has come in after the tap: the last word is in)
  const MIC_PAD_MS = 300; // (silence added after the last word, so Grok hears the sentence end)
  const MIC_PREROLL_MS = 300; // (a mic still open from the last recording keeps this much from just before the tap)
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const appEl = document.getElementById('app');

  // ---------- the mic itself (v10, owner 12 Oct 2026 on the Tesla: "words get cut off from the end … from the
  // front … aren't transcribed as good as when I'm using the Mac"). The sound is made 16 kHz by the browser's own
  // resampler or a properly filtered one (v9 averaged every 3 samples and dropped a sample at
  // each piece's edge: a click every 40 ms), read off the page's thread (AudioWorklet) so a busy screen never drops
  // sound. (The browser's noise filter + auto volume stay on: tried raw like F5, it was no better on a quiet,
  // noisy test mic.) It stays open after a stop while the app is on screen (owner 22 Oct 2026: "doesn't need me to allow
  // the microphone every single time": iOS forgets the yes soon after the mic is closed), so the next tap records at
  // once, with the moment before it, and never asks again. Closed when the app goes to the background.
  const MIC_WORKLET = "registerProcessor('fm-mic',class extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0}process(i){const c=i[0]&&i[0][0];if(c)for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===1024){this.port.postMessage(this.b,[this.b.buffer]);this.b=new Float32Array(1024);this.n=0}}return true}})";
  let mic = null; // { ctx, stream, src, node, sink, rate, ring, ringLen, onPcm, floor, flowing, letGo, dead }
  function micResampler(rate) { // (→ 16 kHz: low-pass below 7.4 kHz, then steps of rate/16000; carries over between pieces)
    if (Math.abs(rate - 16000) < 1) return (f) => f;
    const ratio = rate / 16000; const M = Math.ceil(ratio * 8); const N = 2 * M + 1; const fc = 7400 / rate;
    const h = new Float32Array(N); let s = 0;
    for (let k = 0; k < N; k++) {
      const x = k - M; const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      h[k] = sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * k / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (N - 1))); s += h[k];
    }
    for (let k = 0; k < N; k++) h[k] /= s;
    let hist = new Float32Array(N - 1); let last = 0; let pos = 1;
    return (x) => {
      const m = x.length; const buf = new Float32Array(N - 1 + m); buf.set(hist); buf.set(x, N - 1);
      const y = new Float32Array(m + 1); y[0] = last;
      for (let j = 0; j < m; j++) { let a = 0; for (let k = 0; k < N; k++) a += h[k] * buf[j + k]; y[j + 1] = a; }
      const out = []; while (pos < m) { const i = Math.floor(pos); out.push(y[i] + (y[i + 1] - y[i]) * (pos - i)); pos += ratio; }
      pos -= m; last = y[m]; hist = buf.slice(m);
      return Float32Array.from(out);
    };
  }
  async function micOpen() {
    if (mic && !mic.dead) { clearTimeout(mic.letGo); if (mic.ctx.state !== 'running') await mic.ctx.resume().catch(() => {}); return mic; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This screen can\'t record here.');
    let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); } // (made in the tap itself: iOS wants that)
    const m = mic = { ctx, ring: [], ringLen: 0, onPcm: null, floor: null, flowing: false, dead: false };
    try {
      const resumed = ctx.resume().catch(() => {});
      m.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await resumed;
      let src; try { src = ctx.createMediaStreamSource(m.stream); } catch (e) { // (a browser that only records at the mic's own rate)
        try { ctx.close(); } catch (e2) {}
        ctx = m.ctx = new AC(); await ctx.resume().catch(() => {}); src = ctx.createMediaStreamSource(m.stream);
      }
      m.rate = ctx.sampleRate; const rs = micResampler(m.rate);
      const onSound = (f) => {
        if (m.dead) return;
        const sec = f.length / m.rate; let sq = 0; for (let i = 0; i < f.length; i++) sq += f[i] * f[i];
        const rms = Math.sqrt(sq / (f.length || 1));
        m.floor = Math.min(m.floor == null ? 1 : m.floor * (1 + 0.25 * sec) + 0.002 * sec, rms); // (the room's quiet level, drifting up slowly)
        const g = rs(f); const pcm = new Int16Array(g.length);
        for (let i = 0; i < g.length; i++) pcm[i] = Math.max(-1, Math.min(1, g[i])) * 0x7fff;
        if (!pcm.length) return;
        m.flowing = true;
        if (m.onPcm) { m.onPcm(pcm, rms, sec); return; }
        m.ring.push(pcm); m.ringLen += pcm.length; // (nobody recording: keep only the last MIC_PREROLL_MS)
        while (m.ring.length > 1 && m.ringLen - m.ring[0].length >= 16 * MIC_PREROLL_MS) m.ringLen -= m.ring.shift().length;
      };
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination); // (pulls the sound through, plays nothing)
      let node = null;
      if (ctx.audioWorklet && window.AudioWorkletNode) {
        try {
          const url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: 'application/javascript' }));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          node = new AudioWorkletNode(ctx, 'fm-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          node.port.onmessage = (e) => onSound(e.data);
        } catch (e) { node = null; }
      }
      if (!node) { node = ctx.createScriptProcessor(2048, 1, 1); node.onaudioprocess = (e) => onSound(new Float32Array(e.inputBuffer.getChannelData(0))); }
      src.connect(node); node.connect(sink);
      Object.assign(m, { src, node, sink });
      m.stream.getTracks().forEach((t) => t.addEventListener('ended', () => micRelease(m)));
      m.listen = (fn) => { m.onPcm = fn; };
      m.preroll = () => { const p = m.ring.splice(0); m.ringLen = 0; return p; };
      if (m.dead) throw new Error('stopped');
      return m;
    } catch (e) { micRelease(m); throw e; }
  }
  function micLetGo() { const m = mic; if (!m) return; m.onPcm = null; clearTimeout(m.letGo); }
  function micRelease(m) {
    if (!m || m.dead) return; m.dead = true; if (mic === m) mic = null;
    clearTimeout(m.letGo); m.onPcm = null;
    try { if (m.node) { m.node.disconnect(); if (m.node.port) m.node.port.onmessage = null; } } catch (e) {}
    try { if (m.stream) m.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { m.ctx.close(); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && mic && !mic.onPcm) micRelease(mic); }); // (never open in the background)

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
    puzzle: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 7.5h3.2a2.3 2.3 0 1 1 4.6 0H15v3.3a2.3 2.3 0 1 1 0 4.6V18.5H11.8a2.3 2.3 0 1 0-4.6 0H4V15.4a2.3 2.3 0 1 0 0-4.6z"/></svg>',
    kbd: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="5" width="16.4" height="10.5" rx="2.2"/><path d="M5 8.5h.01M8 8.5h.01M11 8.5h.01M14 8.5h.01M6 12h8"/></svg>',
    zoomin: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.7 12.7 4.3 4.3M8.5 6v5M6 8.5h5"/></svg>',
    expand: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5"/></svg>',
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
    const loc = zhOn() ? 'zh-CN' : [];
    const t = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return `Today ${t}`;
    if (diff === 1) return `Yesterday ${t}`;
    return `${d.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`;
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
  // A locked phone (hello.lock, e.g. Opus 5.5 · Low only): its picker shows just that
  const lock = () => (data.hello && data.hello.lock) || null;
  const newChat = () => { const l = lock(); return l ? { model: l.model, effort: l.effort } : { ...NEW_CHAT }; };
  const modelLabel = (model, effort) => [MODEL_LABEL[model], EFFORT_LABEL[effort]].filter(Boolean).join(' · ');
  function pickerHtml(model, effort) {
    const row = (list, attr, cur) => `<div class="mrow">${list.map(([k, l]) => `<button type="button" data-${attr}="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div>`;
    const l = lock(); const only = (list, k) => (l ? list.filter(([x]) => x === l[k]) : list);
    return `<div class="mpick"><div class="mlab">Model</div>${row(only(MODELS, 'model'), 'model', model)}<div class="mlab">Effort</div>${row(only(EFFORTS, 'effort'), 'effort', effort)}</div>`;
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

  // ---------- Chinese screens (owner 26 Oct 2026, his mother's locked phone: "make everything chinese for her").
  // A phone locked with lang 'zh' shows every label in Simplified Chinese: each text and label the app puts on the
  // screen is looked up here as it appears (Claude's replies and her own words are left as they are). Remembered on
  // the phone, so it starts in Chinese before the computer answers.
  const ZH = {
    'Model': '模型', 'Effort': '思考', 'Retry': '重试', 'Low': '低', 'Medium': '中', 'High': '高', 'xHigh': '很高', 'Max': '最高',
    'Sessions': '对话', 'Session': '对话', 'Folders': '文件夹', 'Folder': '文件夹', 'Settings': '设置', 'Usage': '用量', 'Notifications': '通知',
    'Chat': '聊天', 'Terminal': '终端', 'Copy': '复制', 'Copied': '已复制', 'Stop': '停止', 'Send': '发送', 'Message': '写消息…', 'Save': '保存',
    'Back': '返回', 'Back to sessions': '返回对话', 'Back to folders': '返回文件夹', 'More': '更多', 'Menu': '菜单', 'Undo': '撤销', 'Clear': '清除', 'Paste': '粘贴',
    'Rename': '改名', 'Renamed': '已改名', 'New name': '新名字', 'Restart': '重新开始', 'Close window': '关掉这个对话', 'Close this window': '关掉这个对话',
    'Enhance': '改写', 'Enhance my prompt': '帮我改写', 'Enhancing…': '正在改写…', 'Prompt enhanced': '已改写', 'Add photos': '加照片', 'Remove photo': '去掉照片',
    'Talk (Grok mic)': '说话', 'Stop and put the words in the box': '停止，把话放进框里', 'Cancel recording': '取消录音', 'Listening…': '在听…',
    'Starting the mic…': '正在打开麦克风…', 'Writing it down…': '正在写下来…', 'Writing it down (sending it all)…': '正在写下来…', 'Heard nothing.': '没有听到声音。',
    'Nothing was written down.': '没有写下任何字。', 'The words so far are in the box.': '听到的字已经放进框里了。',
    'My previous prompt': '上一条消息', 'My next prompt': '下一条消息', 'Model and effort': '模型', 'More for this session': '更多',
    'Search sessions': '搜索对话', 'Clear search': '清除搜索', 'No matches': '没有找到', 'Loading…': '正在加载…', 'Connecting…': '正在连接…',
    'Reconnecting…': '正在重新连接…', 'Offline': '没有连上', 'Online': '已连上', 'Checking…': '正在检查…', 'Refreshing…': '正在刷新…', 'Just now': '刚刚', 'just now': '刚刚', 'Never': '从没有',
    'Waiting for you': '等你回复', 'Stopped': '已停止', 'Working': '正在做', 'Done · still running': '好了 · 还在做', 'Idle': '空闲', 'Asleep': '休息中', 'Ended': '已结束', 'Closed': '已关闭',
    'Ready': '准备好了', 'Starting…': '正在开始…', 'Sending…': '正在发送…', 'Sent': '已发送', 'Not sent': '没有发出去', 'Failed': '失败了', 'Unknown': '不知道', 'Untitled': '新对话', 'Untitled chat': '新对话', 'New chat': '新对话',
    'Asleep. Sending wakes it up.': '在休息。发消息就会醒来。', 'This session has ended.': '这个对话已经结束了。', 'Needs you': '等你', 'Nothing needs you right now': '现在没有事要你处理',
    'No sessions open': '没有打开的对话', 'No open sessions': '没有打开的对话', 'Start one from a folder.': '从文件夹开始一个新对话。', 'Open Folders': '打开文件夹',
    'No folders yet': '还没有文件夹', 'Resume a chat': '继续以前的对话', 'No earlier chats in this folder.': '这里还没有以前的对话。', "Couldn't load chats": '对话加载不了',
    'Try again': '再试一次', 'Or start': '或者开始', 'Open': '打开', 'No messages yet': '还没有消息', 'Type below to start.': '在下面打字开始。', 'Show earlier messages': '看更早的消息',
    "It's asking you something": '它在问你', 'Answer with the keys below, or type a reply': '点下面的按钮回答，或者打字回复', 'See it on the Terminal tab': '在「终端」里看',
    'Or type a different answer below.': '或者在下面打别的回答。', 'Answered': '已回答', 'Claude asks': 'Claude 在问', 'Claude asks me something': 'Claude 在问我',
    "The session's terminal, live, as on your computer. You rarely need it: the Chat has everything, and questions show up there as buttons.": '电脑上的画面。一般不需要看：「聊天」里什么都有。',
    'Only photos can be added here.': '这里只能加照片。', 'Sending the photos…': '正在发送照片…', 'Window closed. Its memory is freed.': '对话已经关掉了。',
    'Restarting… same conversation.': '正在重新开始…还是同一个对话。', 'Same conversation, fresh process': '同一个对话，重新开始', 'It moved on to a fresh window. Carrying on there.': '换到一个新的对话继续了。',
    'Something went wrong. Trying again…': '出了一点问题，正在再试…', 'Nothing came back': '没有回复', 'It went away': '不见了',
    'Keep awake': '不要休息', 'Never put to sleep when idle': '空闲时也不休息', 'Kept awake': '不会休息', 'Sleeps when idle again': '空闲时会休息',
    'Frees its memory; resume later from its folder': '关掉，以后可以在文件夹里继续', 'It is still working. Restart anyway? The turn in progress stops.': '它还在做。还是要重新开始吗？正在做的会停下来。',
    'Notification': '通知', 'Notifications are on': '通知已打开', 'Notifications are off on this phone': '这个手机的通知已关掉', 'Notifications not allowed': '通知没有被允许',
    'Notifications are blocked for FoxyMind': '通知被挡住了', 'Turn off on this phone': '在这个手机关掉', 'Send a test': '发一个测试', 'Test sent. It should arrive in a moment.': '已发送测试，马上会收到。',
    'Get a notification when a session turns blue and needs you.': '对话等你回复时，收到通知。', 'One notification per session; tap it to open that session.': '点通知就会打开那个对话。',
    'This browser can\'t show notifications.': '这个浏览器不能显示通知。', 'Connection': '连接', 'Last seen': '上次连上', 'Address': '地址', 'FoxyMind build': '版本',
    'This phone': '这个手机', 'Unpair this phone': '取消这个手机的连接', 'This phone is unpaired': '这个手机已取消连接', 'This phone was unpaired': '这个手机的连接已取消',
    'This phone was unpaired. Pair it again to continue.': '这个手机的连接已取消。请重新连接。', "Unpairing removes this phone from FoxyMind. You'll need a new pair link to use it again.": '取消后，这个手机就不能用了，要新的连接才可以再用。',
    'Other screens': '其他屏幕', 'Pair another screen': '连接另一个屏幕', 'Pair': '连接', 'Pair code': '连接码', 'Pair link': '连接链接', 'Have a pair code?': '有连接码吗？', 'Or paste a pair link': '或者粘贴连接链接',
    'Get a new code': '拿新的码', 'Getting a code…': '正在拿码…', 'For your car, a tablet or any browser: type a short code there instead of a link.': '平板或别的浏览器：在那里输入这个短码。',
    'On the other screen, open': '在另一个屏幕打开', 'That code was already used or is too old. Get a new one.': '这个码已经用过或太旧了，请拿新的。',
    'Your sessions, on your phone.': '在手机上和 Claude 聊天。', 'Add to Home Screen': '添加到主屏幕', 'Copy pair link': '复制连接链接', 'Tap': '点', 'Share': '分享', 'then': '然后', 'from your Home Screen.': '从主屏幕打开。', 'Paste your pair link there.': '在那里粘贴连接链接。',
    'Duplicate': '复制一个', 'Duplicated': '已复制', 'Not now': '先不要', 'Type': '打字', 'Enter key': '确认键', 'Delete key': '删除键', 'Wrap on': '自动换行', 'Wrap off': '不换行',
    'Projects': '项目', 'Desktop': '桌面', 'Where': '位置', 'Folder name': '文件夹名字', 'Project name': '名字', 'New folder': '新文件夹', 'Make folder': '建文件夹',
    'Tool': '工具', 'Done, but a background job still runs.': '好了，还有一点在后台做。',
    'Mac is offline or asleep': '电脑没有连上', 'Mac and Windows are offline or asleep': '电脑没有连上', 'Showing the last update.': '显示的是最后的内容。',
    "Your computers haven't answered yet": '电脑还没有回应', 'Opus 5.5 · Low': 'Opus 5.5',
    'FoxyMind': '小帮手', '👩 Mum': '👩 妈妈', 'Mac': '电脑', 'Windows': '电脑','Asked you something': '在问你', 'Asleep / ended': '休息中 / 已结束', 'Needs you': '等你', 'New Claude chat': '新对话',
    "Windows didn't answer, so its chats aren't listed.": '电脑没有回应，以前的对话没有列出来。', 'Turn on notifications': '打开通知', 'Off or asleep': '没开或休息中',
    'Do you want to proceed?': '要继续吗？', 'Yes': '是', 'No': '不要', 'No, and tell Claude what to do differently': '不要，告诉 Claude 要怎么做',
    'up': '上', 'down': '下', 'enter': '确认', 'esc': '取消', 'Enter': '确认', 'Esc': '取消',
    'Read': '看文件', 'Write': '写文件', 'Edit': '改文件', 'Grep': '找', 'Glob': '找文件', 'WebSearch': '上网查', 'WebFetch': '看网页', 'Agent': '助手', 'Task': '助手', 'TodoWrite': '计划', 'AskUserQuestion': '问你',
  };
  // (state words in the lists, e.g. "waiting 11m", "3 working")
  const ZH_WORD = { waiting: '等你', working: '正在做', stopped: '已停止', 'still running': '还在做', idle: '空闲', asleep: '休息中', ended: '已结束' };
  const ZH_RE = [
    [/^(\d+)s$/, '$1秒'], [/^(\d+)m$/, '$1分钟'], [/^(\d+)h$/, '$1小时'], [/^(\d+)d$/, '$1天'], [/^(\d+)mo$/, '$1个月'],
    [/^(\d+)(s|m|h|d|mo) ago$/, (m, n, u) => `${n}${{ s: '秒', m: '分钟', h: '小时', d: '天', mo: '个月' }[u]}前`],
    [/^Today (.+)$/, '今天 $1'], [/^Yesterday (.+)$/, '昨天 $1'], [/^(\d+) steps$/, '$1 个步骤'],
    [/^Photo not added: (.+)$/, (m, why) => `照片没有加上：${zhText(why)}`], [/^(\d+) photos at most in one message\.$/, '一条消息最多 $1 张照片。'],
    [/^Can't reach your computers.*$/, '连不上电脑，请稍后再试。'], [/^Couldn't (.+?): (.+)$/, '没有成功：$2'], [/^Now on (.+)$/, '现在用 $1'],
    [/^(.+) online$/, '已连上'], [/^Last seen (.+) ago\.$/, (m, a) => `上次连上：${zhText(a)}前。`], [/^Updated (.+) ago$/, (m, a) => `${zhText(a)}前更新`],
    [/^Paired with .+$/, '已连接'], [/^Something went wrong \(\d+\)$/, '出了一点问题'], [/^A photo .+$/, '有一张照片没有送到，请再加一次。'],
    [/^Will send when it.+$/, '它好了就会发送'], [/^Not sent: (.+)$/, (m, why) => `没有发出去：${zhText(why)}`],
    [/^(waiting|working|stopped|still running|idle|asleep|ended) (\S+)$/, (m, w, a) => `${ZH_WORD[w]} ${zhText(a)}`],
    [/^(\d+) (waiting|working|stopped|still running|idle|asleep|ended)$/, (m, n, w) => `${n} ${ZH_WORD[w]}`],
    [/^(\d+) folders?$/, '$1 个文件夹'], [/^(\d+) sessions?$/, '$1 个对话'], [/^(\d+) open$/, '$1 个打开'], [/^Last: (.+)$/, '最后：$1'],
    [/^Yes, and don't ask again.*$/, '是，以后不用再问'], [/^Wrap: (on|off)$/, (m, o) => (o === 'on' ? '自动换行' : '不换行')],
    [/^(.+ · .+)$/, (m, all) => all.split(' · ').map((x) => zhText(x)).join(' · ')], // (labels joined with a dot: each part on its own)
  ];
  function zhText(s) {
    const t = String(s).trim(); if (!t || !/[A-Za-z]/.test(t)) return s;
    if (Object.prototype.hasOwnProperty.call(ZH, t)) return String(s).replace(t, ZH[t]);
    for (const [re, to] of ZH_RE) if (re.test(t)) return String(s).replace(t, t.replace(re, to));
    return s;
  }
  const zhOn = () => { const l = data.hello && data.hello.lock; return l ? l.lang === 'zh' : !!store.zh; };
  // (her words, Claude's replies, the live screen, anything typed: never changed)
  const ZH_SKIP = '.md, .msg.user, .msg.system, pre, code, textarea, input, .term, .mtext, .what';
  const ZH_ATTRS = ['aria-label', 'placeholder', 'title'];
  function zhNode(n) {
    if (n.nodeType === 3) {
      const p = n.parentElement; if (!p || p.closest(ZH_SKIP)) return;
      const v = zhText(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
      return;
    }
    if (n.nodeType !== 1 || n.closest(ZH_SKIP.replace('textarea, input, ', ''))) return;
    for (const a of ZH_ATTRS) { const v = n.getAttribute(a); if (v) { const z = zhText(v); if (z !== v) n.setAttribute(a, z); } }
    if (n.closest('textarea, input')) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let x = w.nextNode(); x; x = w.nextNode()) {
      if (x.nodeType === 3) zhNode(x);
      else for (const a of ZH_ATTRS) { const v = x.getAttribute(a); if (v) { const z = zhText(v); if (z !== v) x.setAttribute(a, z); } }
    }
  }
  let zhObs = null;
  function zhApply() {
    const on = zhOn();
    if (on !== !!store.zh) { store.zh = on; save(); }
    document.documentElement.lang = on ? 'zh-CN' : 'en';
    if (!on) { if (zhObs) { zhObs.disconnect(); zhObs = null; } return; }
    if (zhObs) return;
    zhNode(document.body);
    zhObs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') zhNode(m.target);
        else if (m.type === 'attributes') zhNode(m.target);
        else for (const n of m.addedNodes) zhNode(n);
      }
    });
    zhObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ZH_ATTRS });
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
    if (h.computer) { if (routeNow() === 'mac') store.macName = h.computer; else store.pcName = h.computer; }
    store.features = Array.isArray(h.features) ? h.features : [];
    save();
    zhApply();
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
    const name = esc(routeName());
    const label = conn.state === 'online' ? `${name} online` : conn.state === 'reconnecting' ? 'Reconnecting…' : conn.state === 'offline' ? 'Offline' : 'Connecting…';
    return `<span class="connpill ${conn.state}" role="status"><i></i>${label}</span>`;
  }
  function offlineBanner() {
    // (in through Windows: its own sessions only, until the Mac answers again)
    if (conn.state !== 'offline') return routeNow() === 'pc' && conn.state === 'online' ? `<div class="offbanner via"><div class="grow"><b>${esc(store.macName || 'Mac')} can't be reached</b>Showing the sessions on ${esc(routeName())}. It switches back by itself.</div><button class="btn-sm" data-act="retry">Retry</button></div>` : '';
    const seen = store.lastSeen ? ` Last seen ${age(store.lastSeen)} ago.` : '';
    return `<div class="offbanner"><div class="grow"><b>${baseOf('pc') ? 'Mac and Windows are offline or asleep' : 'Mac is offline or asleep'}</b>Showing the last update.${seen}</div><button class="btn-sm" data-act="retry">Retry</button></div>`;
  }
  function paintConn() {
    $$('.connpill').forEach((el) => { el.outerHTML = connPill(); });
    $$('.offline-slot').forEach((el) => { el.innerHTML = offlineBanner(); });
    $$('.scroll.can-stale').forEach((el) => el.classList.toggle('stale', conn.state === 'offline'));
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="retry"]');
    if (!b) return;
    if (conn.state !== 'online') setConn('reconnecting');
    conn.lastDiscover = 0; conn.pickedAt = 0;
    if (routeNow() === 'pc') pickRoute().catch(() => {}); // (try the Mac again now)
    kickAll();
  });

  // ---------- finding the computers + API ----------
  // store.bases = { mac, pc }: each computer's current tunnel address; store.route = the one in use.
  const ntfyBase = () => store.ntfy || 'https://ntfy.sh';
  if (!store.bases) { store.bases = store.base ? { mac: store.base } : {}; }
  const routeNow = () => (store.devBase ? 'mac' : store.route === 'pc' ? 'pc' : 'mac');
  const routeName = () => (routeNow() === 'pc' ? store.pcName || 'Windows' : store.macName || 'Mac');
  const baseOf = (r) => (store.bases && store.bases[r]) || null;
  const currentBase = () => store.devBase || baseOf(routeNow()) || null;
  let discovering = null;
  async function discover() {
    if (store.devBase) return store.devBase;
    if (!store.topic) throw new Error('This phone isn\'t paired');
    conn.lastDiscover = Date.now();
    const r = await fetch(`${ntfyBase()}/${encodeURIComponent(store.topic)}/json?poll=1&since=24h`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Couldn\'t look up the Mac\'s address');
    const txt = await r.text();
    const found = {}; // the newest address of each computer: the Mac's "url: …", Windows' "win: …"
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (!o || o.event !== 'message' || typeof o.message !== 'string') continue;
        if (o.message.startsWith('url: ')) found.mac = o.message.slice(5).trim().replace(/\/+$/, '');
        else if (o.message.startsWith('win: ')) found.pc = o.message.slice(5).trim().replace(/\/+$/, '');
      } catch (e) { /* skip */ }
    }
    if (!found.mac && !found.pc) throw new Error('Your computers haven\'t posted an address yet. Is FoxyMind running?');
    store.bases = Object.assign({}, store.bases, found);
    store.base = store.bases.mac || null; // (as older versions of the app kept it)
    save();
    return currentBase() || baseOf('mac') || baseOf('pc');
  }
  function rediscover() {
    if (!discovering) discovering = discover().finally(() => { discovering = null; });
    return discovering;
  }

  // Which computer to talk to: the Mac when it answers, else Windows. One look at a time; the last answer is kept
  // 4 s, so the lists polling together don't each go looking.
  async function ping(base, ms) {
    if (!base) return false;
    try {
      const ctl = window.AbortController ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), ms || 6000) : null;
      const r = await fetch(`${base}/phone/api/ping`, { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
      const j = await r.json();
      if (timer) clearTimeout(timer);
      return !!(r.ok && j && j.ok);
    } catch (e) { return false; }
  }
  function setRoute(r) {
    if (routeNow() === r) return;
    store.route = r; save();
    // (another computer answers now: what it can do and its lists are its own)
    data.hello = null; data.machines = null; data.usage = null; data.folders = null; data.notes = null; data.captchas = null;
    paintConn();
    if (store.token) api('GET', '/hello').then(setHello).catch(() => {});
    setTimeout(kickAll, 0);
  }
  let picking = null;
  function pickRoute() {
    if (store.devBase) return Promise.resolve(store.devBase);
    if (picking) return picking;
    if (conn.pickedAt && Date.now() - conn.pickedAt < 4000) return Promise.resolve(conn.picked ? baseOf(conn.picked) : null);
    picking = (async () => {
      if (store.topic && Date.now() - conn.lastDiscover > 15000) { try { await rediscover(); } catch (e) { /* the addresses we have */ } }
      const [mac, pc] = await Promise.all([ping(baseOf('mac')), ping(baseOf('pc'))]);
      conn.reach = { mac, pc };
      conn.picked = mac ? 'mac' : pc ? 'pc' : null;
      conn.pickedAt = Date.now();
      if (conn.picked) setRoute(conn.picked);
      return conn.picked ? baseOf(conn.picked) : null;
    })().finally(() => { picking = null; });
    return picking;
  }
  // In through Windows: look for the Mac every 20 s (its address may be a new one) and go back when it answers
  async function backToMac() {
    if (store.devBase || routeNow() !== 'pc' || !store.token) return;
    if (Date.now() - conn.lastDiscover > 30000) { try { await rediscover(); } catch (e) { /* keep */ } }
    if (await ping(baseOf('mac'))) { conn.reach = Object.assign({}, conn.reach, { mac: true }); conn.pickedAt = 0; setRoute('mac'); }
  }

  class ApiError extends Error {
    constructor(msg, status, offline) { super(msg); this.status = status; this.offline = !!offline; }
  }
  const BAD_GATEWAY = [502, 503, 504, 520, 521, 522, 523, 524, 530];

  async function api(method, path, body, opts = {}) {
    const auth = opts.auth !== false;
    let base = opts.base || currentBase(); // (opts.base: this computer only, e.g. the one holding a mic recording)
    if (!base) {
      setConn('reconnecting');
      try { base = await rediscover(); } catch (e) { setConn('offline'); throw new ApiError(e.message || 'Can\'t find your computers', 0, true); }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      let res = null;
      let data = null;
      let bad = false;
      let late = false; // it ran out of time: the computer may have got it all the same
      try {
        const headers = {};
        if (opts.raw) headers['Content-Type'] = opts.type || 'application/octet-stream'; // (a photo, a piece of sound)
        else if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth && store.token) headers.Authorization = `Bearer ${store.token}`;
        const ctl = window.AbortController ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => { late = true; ctl.abort(); }, opts.timeout || 15000) : null;
        res = await fetch(`${base}/phone/api${path}`, {
          method, headers, mode: 'cors', cache: 'no-store', credentials: 'omit',
          body: opts.raw ? opts.raw : body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctl ? ctl.signal : undefined,
        });
        if (opts.blob && res.ok) { const b = await res.blob(); if (timer) clearTimeout(timer); markOk(); return b; } // (a picture)
        const text = await res.text();
        if (timer) clearTimeout(timer);
        try { data = text ? JSON.parse(text) : {}; } catch (e) { bad = true; } // a Cloudflare error page
        if (BAD_GATEWAY.includes(res.status)) bad = true;
        // (Windows not knowing this phone is Windows not having heard from the Mac yet: only the Mac's word unpairs)
        if (res.status === 401 && auth && !store.devBase && base === baseOf('pc') && base !== baseOf('mac')) bad = true;
      } catch (e) { bad = true; }

      if (!bad) {
        if (res.status === 401 && auth) { onRevoked(); throw new ApiError('This phone was unpaired', 401); }
        markOk();
        if (!res.ok) throw new ApiError((data && data.error) || `Something went wrong (${res.status})`, res.status);
        if (opts.used) opts.used(base);
        return data;
      }
      if (attempt > 0) break;
      setConn('reconnecting');
      if (store.devBase || opts.base) { if (opts.base && method !== 'GET' && late) break; await sleep(400); continue; }
      // the tunnel may have moved, or this computer is offline and the other one isn't: the current addresses from
      // ntfy, then whichever of the two answers (the Mac first)
      if (!store.topic) break;
      const nb = await pickRoute();
      if (!nb) break;
      // (a message or a key that may have arrived is never sent a second time: Windows' sessions answer on both ways in)
      if (method !== 'GET' && late) break;
      base = nb;
    }
    // one missed answer is a blip (mobile data, a busy computer): keep "Reconnecting…" while one answered in the last
    // 25 s; the polls carry on, and only a longer silence shows "offline or asleep"
    setConn(store.lastSeen && Date.now() - store.lastSeen < 25000 ? 'reconnecting' : 'offline');
    throw new ApiError('Can\'t reach your computers', 0, true);
  }

  function onRevoked() {
    const had = !!store.token;
    delete store.token; delete store.base; delete store.deviceId; store.bases = {}; delete store.route;
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
  const data = { sessions: null, counts: { blue: 0, orange: 0, half: 0 }, at: 0, hello: null, folders: null, notes: null, machines: null, usage: null, captchas: null };
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
  let notesLoop = null; let machinesLoop = null; let cvLoop = null; let backLoop = null;
  // robot checks on any computer (lib/captchaview.js): a red line over the sessions list until solved
  async function fetchCaptchas() {
    if (!has('captcha')) return;
    const r = await api('GET', '/captchas');
    data.captchas = Array.isArray(r.checks) ? r.checks : [];
    subs.forEach((f) => f('captchas'));
  }
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
    if (!cvLoop) cvLoop = loop(fetchCaptchas, 5000);
    if (!backLoop) backLoop = loop(backToMac, 20000);
    if (!data.hello) api('GET', '/hello').then((h) => { setHello(h); if (notesLoop) notesLoop.kick(); if (machinesLoop) machinesLoop.kick(); if (cvLoop) cvLoop.kick(); }).catch(() => {});
  }
  function stopGlobal() {
    if (sessionsLoop) { sessionsLoop.stop(); sessionsLoop = null; }
    if (notesLoop) { notesLoop.stop(); notesLoop = null; }
    if (machinesLoop) { machinesLoop.stop(); machinesLoop = null; }
    if (cvLoop) { cvLoop.stop(); cvLoop = null; }
    if (backLoop) { backLoop.stop(); backLoop = null; }
    data.sessions = null; data.hello = null; data.folders = null; data.notes = null; data.machines = null; data.usage = null; data.captchas = null;
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
    if ((m = h.match(/^#\/cv\/([A-Za-z0-9_.%-]+)\/(cv_[0-9a-f]{10})$/))) return show(CaptchaView(decodeURIComponent(m[1]), m[2]));
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

  // v9 (11 Oct 2026, the owner's Tesla): a 6-letter code typed on a screen with no Telegram or clipboard. The computer
  // posted its topic on ntfy under a name only the code gives (lib/phone.js pairTopic: the same sum).
  const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const deviceName = () => (/Tesla/i.test(navigator.userAgent) ? 'Tesla' : isIOS ? 'iPhone' : /Android/i.test(navigator.userAgent) ? 'Android' : 'Browser');
  async function pairCode(raw) {
    const code = normCode(raw);
    if (!CODE_RE.test(code)) throw new Error('A pair code is 6 letters and numbers, like K7MPQ3.');
    if (!(window.crypto && crypto.subtle)) throw new Error('This browser can\'t check the code here. Use a pair link instead.');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`foxymind-pair:${code}`));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    let topic = null;
    for (let tries = 0; !topic && tries < 3; tries++) { // (a code made a moment ago can take a few seconds to show up on ntfy)
      if (tries) await sleep(2500);
      try {
        const r = await fetch(`${ntfyBase()}/fm-pair-${hex.slice(0, 32)}/json?poll=1&since=1h`, { cache: 'no-store' });
        for (const line of (await r.text()).split('\n')) {
          try { const o = JSON.parse(line); const m = o && o.event === 'message' && /^topic: (fm-phone-[0-9a-f]{24})$/.exec(String(o.message || '').trim()); if (m) topic = m[1]; } catch (e) { /* skip */ }
        }
      } catch (e) { if (tries === 2) throw new Error('Can\'t check the code: no internet?'); }
    }
    if (!topic) throw new Error('That code isn\'t known (or it\'s over 15 minutes old). Check it, or get a new one.');
    return pair(`${topic}.${code}`);
  }

  async function pair(raw) {
    const p = parsePair(raw);
    if (!p) throw new Error('That doesn\'t look like a pair link. It ends with #pair=…');
    store.topic = p.topic;
    delete store.base; store.bases = {}; delete store.route;
    save();
    if (!store.devBase) {
      try { await discover(); } catch (e) { throw new Error(`Can't find your computers. ${e.message || ''}`.trim()); }
      await pickRoute(); // (the Mac, or Windows when the Mac is offline: a pair link works on both)
    }
    let r;
    try {
      r = await api('POST', '/pair', { code: p.code, name: deviceName() }, { auth: false });
    } catch (e) {
      if (e.offline) throw new Error('Can\'t reach your Mac or Windows. Is one awake with FoxyMind open?');
      if (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 410) throw new Error(/^[A-Z0-9]{6}$/.test(p.code) ? 'That code was already used or is too old. Get a new one.' : `${e.message}. Ask FoxyMind for a new pair link.`);
      throw e;
    }
    if (!r || !r.token) throw new Error('The Mac didn\'t send a key back. Try a new pair link.');
    store.token = r.token;
    store.deviceId = r.deviceId;
    if (routeNow() === 'pc') store.pcName = r.name || 'Windows'; else store.macName = r.name || 'Mac';
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
        <div class="card codecard">
          <h3>Have a pair code?</h3>
          <input class="codebox" maxlength="7" placeholder="K7MPQ3" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Pair code">
          <div class="btnrow"><button class="btn primary" data-act="paircode" disabled>Pair</button></div>
          <p class="err codeerr" role="alert"></p>
          <p class="codehint">On your iPhone: FoxyMind → Settings → <b>Pair another screen</b>.</p>
        </div>
        <div class="card">
          <h3>Or paste a pair link</h3>
          <textarea class="pairbox" rows="3" placeholder="https://…#pair=…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Pair link"></textarea>
          <div class="btnrow"><button class="btn secondary" data-act="paste">Paste</button><button class="btn primary" data-act="pair" disabled>Pair</button></div>
          <p class="err" role="alert"></p>
        </div>
        <p class="fine">Get your pair link from FoxyMind on your Mac (Settings → Phone) or from Telegram.</p>`;
    }
    const el = screenEl('pair', `<div class="scroll"><div>${body}</div></div>`);
    const box = $('.pairbox', el);
    const btn = $('[data-act="pair"]', el);
    const err = $('.err:not(.codeerr)', el);
    const cbox = $('.codebox', el);
    if (cbox) {
      const cbtn = $('[data-act="paircode"]', el); const cerr = $('.codeerr', el);
      const ready = () => CODE_RE.test(normCode(cbox.value));
      const go1 = async () => {
        if (!ready() || cbtn.dataset.busy) return;
        cerr.textContent = ''; cbtn.dataset.busy = '1'; cbtn.disabled = true; cbtn.innerHTML = '<span class="spin"></span>Pairing…';
        try {
          await pairCode(cbox.value);
          toast(`Paired with ${routeName()}`);
          history.replaceState(null, '', location.pathname + location.search + '#/');
          route();
        } catch (e) { cerr.textContent = e.message || String(e); cbtn.textContent = 'Pair'; delete cbtn.dataset.busy; cbtn.disabled = !ready(); }
      };
      cbox.addEventListener('input', () => { cbox.value = cbox.value.toUpperCase(); cbtn.disabled = !ready(); cerr.textContent = ''; });
      cbox.addEventListener('keydown', (e) => { if (e.key === 'Enter') go1(); });
      cbtn.addEventListener('click', go1);
    }

    async function doPair(raw) {
      if (!btn) return;
      err.textContent = '';
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Pairing…';
      try {
        await pair(raw);
        toast(`Paired with ${routeName()}`);
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
    catch (e) { toast(e.offline ? 'Can\'t reach your computers' : e.message, 'err'); if (btn) btn.disabled = false; }
  }
  // The red "Robot check" lines over the sessions list (open ones; a solved one shows green for 2 min)
  const cvHref = (c) => `#/cv/${encodeURIComponent(c.machine || 'mac')}/${encodeURIComponent(c.id)}`;
  function captchaLines() {
    if (!has('captcha') || !Array.isArray(data.captchas)) return '';
    return data.captchas.filter((c) => c.status === 'open' || (c.status === 'solved' && Date.now() - (c.doneAt || 0) < 120000)).map((c) => {
      const who = (c.sessions || [])[0];
      if (c.status === 'solved') return `<a class="cvbar done" href="${cvHref(c)}"><span class="cvico">${I.check}</span><span class="grow">Robot check solved<small>${esc(c.siteName)} · ${esc(c.where || '')}${who ? ` · ${esc(who)} carries on` : ''}</small></span></a>`;
      return `<a class="cvbar" href="${cvHref(c)}"><span class="cvico">${I.puzzle}</span><span class="grow">Robot check on ${esc(c.where || 'a computer')}<small>${esc(c.siteName)} · ${esc(c.chrome || 'Chrome')}${who ? ` · ${esc(who)} is waiting` : ''} · ${age(c.at)}</small></span><span class="btn-sm solve">Solve</span></a>`;
    }).join('');
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
    } catch (e) { toast(e.offline ? 'Can\'t reach your computers' : `Couldn't wake it: ${e.message}`, 'err'); }
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
    } catch (e) { toast(e.offline ? 'Can\'t reach your computers' : `Not changed: ${e.message}`, 'err'); }
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
        } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : err.message, 'err'); busy = false; b.classList.remove('busy'); }
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
      <div class="scroll can-stale"><div class="cvline"></div><div class="pcline"></div><div class="groups"></div></div>
      ${tabbar('sessions')}`);
    const groupsEl = $('.groups', el);
    const subrow = $('.subrow .counts', el);
    const scroll = $('.scroll', el);
    const pcline = $('.pcline', el);
    const sq = $('.sq', el);
    let query = '';
    let lastHtml = '';
    let unwatch = () => {};

    const cvline = $('.cvline', el);
    function render() {
      const cvh = captchaLines();
      if (cvline.innerHTML !== cvh) cvline.innerHTML = cvh;
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
    cvline.addEventListener('click', (e) => { const a = e.target.closest('a.cvbar'); if (a) { e.preventDefault(); go(a.getAttribute('href'), 'push'); } });

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
      mounted() { unwatch = watchBars(el); subs.add(render); render(); if (sessionsLoop) sessionsLoop.kick(); if (machinesLoop) machinesLoop.kick(); if (cvLoop) cvLoop.kick(); },
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
        // (a phone fenced to one folder: a picture of that folder in the reply, ![x](images/x.png), is shown)
        const pics = []; let txt = p.text;
        if (lock() && lock().oneFolder) txt = txt.replace(/!\[[^\]\n]*\]\(((?:images|notes|dashboards)\/[^()\s]+\.(?:png|jpe?g|webp|gif))\)/gi, (m, f) => { pics.push(f); return `FMPIC${pics.length - 1}Z`; });
        const html = window.md.render(txt)
          .replace(/<pre class="code"([^>]*)><button type="button" class="copy" title="Copy">Copy<\/button>/g, '<div class="codewrap"><button type="button" class="copy">Copy</button><pre class="code"$1>')
          .replace(/<\/code><\/pre>/g, '</code></pre></div>')
          .replace(/FMPIC(\d+)Z/g, (m, i) => (pics[i] ? `<img class="fpic" data-file="${esc(pics[i])}" alt="">` : m));
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
          <label class="cbtn pbtn" data-act="photo" aria-label="Add photos" role="button">${I.photo}<input class="pfile" type="file" accept="image/*" multiple></label>
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
      } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : `Not changed: ${err.message}`, 'err'); }
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
      } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : `Couldn't enhance: ${err.message}`, 'err'); }
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
    // This window was closed after handing over to a fresh one (its context filled up): carry on in that one, with
    // what's typed in the box (owner 13 Oct 2026: "Not sent: Windows: pane not found")
    let followed = false;
    function follow(to) {
      if (followed || !to || to === id) return;
      followed = true;
      if (box.value.trim()) lsSet(`draft.${to}`, box.value);
      toast('It moved on to a fresh window. Carrying on there.');
      navDir = 'fade'; location.replace(`#/s/${encodeURIComponent(to)}`);
    }
    function onSessions() {
      const s = (data.sessions || []).find((x) => x.id === id) || null;
      if (!s && data.sessions) { const nx = data.sessions.find((x) => x.from === id); if (nx) { follow(nx.id); return; } }
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
      } catch (err) { qBusy = false; qcard.classList.remove('busy'); b.classList.remove('picked'); toast(err.offline ? 'Can\'t reach your computers' : `Not sent: ${err.message}`, 'err'); }
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
      } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : `Key not sent: ${err.message}`, 'err'); }
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
    let shots = []; // { key, url, name, file → blob (made smaller), state: 'up' | 'ok' | 'err', photoId, job }
    function paintShots() {
      photosEl.hidden = !shots.length;
      photosEl.innerHTML = shots.map((p) => `<div class="shot ${p.state}" data-key="${p.key}"><img src="${p.url}" alt=""><button class="shotx" data-act="shotx" aria-label="Remove photo">${I.close}</button>${p.state === 'up' ? '<i class="spin"></i>' : p.state === 'err' ? '<b>!</b>' : ''}</div>`).join('');
      // (a photo this phone can't draw, e.g. HEIC: a picture sign instead of a broken one; it still goes)
      $$('img', photosEl).forEach((i) => { i.onerror = () => { const x = document.createElement('i'); x.className = 'nopic'; x.textContent = '🖼️'; i.replaceWith(x); }; });
      grow();
    }
    const OKTYPE = /^image\/(png|gif|webp|jpeg)$/;
    const PHOTO_MAX = 100;
    function shrinkPhoto(file) {
      return new Promise((res, rej) => {
        if (/gif/.test(file.type)) { res(file); return; }
        const url = URL.createObjectURL(file); const img = new Image();
        img.onload = () => {
          const k = Math.min(1, (shots.length > 10 ? 1600 : 2048) / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          c.toBlob((b) => res(b || file), 'image/jpeg', 0.86);
        };
        // (a picture the phone can't draw, e.g. HEIC on Android: sent as it is; the computer makes it a JPEG
        // (features 'anyphoto'), an older one takes only what Claude reads)
        img.onerror = () => { URL.revokeObjectURL(url); if (OKTYPE.test(file.type) || has('anyphoto')) res(file); else rej(new Error('this kind of picture can\'t be read. Try a screenshot of it.')); };
        img.src = url;
      });
    }
    // Owner 26 Oct 2026 (his mother's Android, many photos at once: some went, some didn't): all of them uploading
    // together over the tunnel timed out; they now go 3 at a time, the rest wait their turn (spinner on each).
    let upRunning = 0; const upQueue = [];
    function upNext() {
      while (upRunning < 3 && upQueue.length) {
        const [p, done] = upQueue.shift();
        if (!shots.includes(p)) { done(); continue; } // (taken out while waiting)
        upRunning++;
        upload(p).then(() => { upRunning--; done(); upNext(); });
      }
    }
    const queueUpload = (p) => { p.state = 'up'; p.job = new Promise((done) => { upQueue.push([p, done]); }); upNext(); return p.job; };
    // (sent to the computer at once, so Send is quick; the made-smaller copy is kept: if the computer forgot it
    // (it restarted for an update, or the phone switched Mac ↔ Windows), Send uploads it again by itself)
    function upload(p) {
      p.state = 'up'; p.photoId = null;
      p.job = (p.blob ? Promise.resolve(p.blob) : shrinkPhoto(p.file).then((b) => { p.blob = b; p.file = null; return b; }))
        .then((b) => api('POST', `/sessions/${encodeURIComponent(id)}/photo?name=${p.name}`, undefined, { raw: b, type: OKTYPE.test(b.type) || !has('anyphoto') ? (OKTYPE.test(b.type) ? b.type : 'image/jpeg') : (b.type || 'application/octet-stream'), timeout: 200000 }))
        .then((r) => { p.photoId = r.photoId; p.state = 'ok'; }, (e) => { p.state = 'err'; toast(e.offline ? 'Can\'t reach your computers. Photo not added.' : `Photo not added: ${e.message}`, 'err'); })
        .then(paintShots);
      return p.job;
    }
    const maxPhotos = () => (has('anyphoto') ? PHOTO_MAX : 20);
    function addPhotos(files) {
      // (Android hands some photos over without a type: kept, the computer works out what they are)
      const pics = [...files].filter((f) => !f.type || /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?|avif)$/i.test(f.name || ''));
      if (pics.length < files.length) toast('Only photos can be added here.', 'err');
      if (shots.length + pics.length > maxPhotos()) toast(`${maxPhotos()} photos at most in one message.`, 'err');
      for (const f of pics.slice(0, Math.max(0, maxPhotos() - shots.length))) {
        const p = { key: Math.random().toString(36).slice(2), url: URL.createObjectURL(f), file: f, name: encodeURIComponent((f.name || 'photo').replace(/\.\w+$/, '')) };
        shots.push(p); queueUpload(p);
      }
      paintShots();
    }
    pfile.addEventListener('change', () => { if (pfile.files && pfile.files.length) addPhotos(pfile.files); pfile.value = ''; });
    // (a photo copied on the phone, then Paste in the box: added like a picked one)
    box.addEventListener('paste', (e) => {
      const fl = [...((e.clipboardData && e.clipboardData.items) || [])].filter((x) => x.kind === 'file' && /^image\//.test(x.type)).map((x) => x.getAsFile()).filter(Boolean);
      if (!fl.length) return;
      e.preventDefault(); addPhotos(fl);
    });
    photosEl.addEventListener('click', (e) => {
      const x = e.target.closest('[data-act="shotx"]'); if (!x) return;
      const k = x.closest('.shot').dataset.key; const p = shots.find((q) => q.key === k);
      shots = shots.filter((q) => q !== p); if (p) URL.revokeObjectURL(p.url);
      paintShots();
    });

    // ----- the mic: Grok Voice Transcribe, the same as F5 on the Mac. Tap to talk, tap again to stop: the words go
    // into the box where the cursor is (not sent), like F5. The sound goes to the Mac in pieces while you speak. -----
    const micBtn = $('.micbtn', el); const micline = $('.micline', el); const mtext = $('.mtext', el);
    let rec = null; // { id, base, started, queue, all, heard, live, lost, sending, tick, tail }
    let micWriting = null; // (a stop still writing the words down: Send waits for it, so the whole sentence goes)
    // Never lose the words (owner 11 Oct 2026 on the Tesla: "tap the mic, speak, tap again, nothing comes out"):
    // a recording lives on the computer it started on, so every piece and the stop go to THAT computer (the app
    // moves between the Mac and Windows when one stops answering; the other one said "That recording has ended").
    // The phone also keeps the whole recording: if the live one is lost anyway (server restart, long signal gap),
    // the stop sends all of it to /mic/once on whichever computer answers.
    function paintMic() {
      micBtn.hidden = !!(data.hello && data.hello.mic === false);
      micBtn.classList.toggle('on', !!rec); micBtn.innerHTML = rec ? I.stop : I.mic;
      micBtn.setAttribute('aria-label', rec ? 'Stop and put the words in the box' : 'Talk (Grok mic)');
      micline.hidden = !rec;
      sendBtn.disabled = !rec && !box.value.trim() && !shots.length; // (Send while it listens = stop and send)
    }
    function joinPcm(parts) {
      const n = parts.reduce((a, p) => a + p.length, 0);
      const pcm = new Int16Array(n); let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
      return pcm;
    }
    const micSeq = () => !!(data.hello && (data.hello.features || []).includes('micseq'));
    async function pump(r, all) {
      if (r.lost) { r.queue.length = 0; return; } // (the live recording is gone: the stop sends the whole thing)
      if (r.seqMode && !all) { // (numbered pieces: each goes at once, the Mac puts them in order)
        if (!r.queue.length || !r.id) return;
        const seq = r.seq++; const pcm = joinPcm(r.queue.splice(0));
        const x = await api('POST', `/mic/${r.id}/audio?seq=${seq}`, undefined, { raw: new Blob([pcm.buffer]), timeout: 20000, base: r.base });
        if (rec === r && x && x.text && seq >= (r.shown || 0)) { r.shown = seq; r.heard = x.text; mtext.textContent = x.text; }
        return;
      }
      if (r.sending) return; r.sending = true;
      try {
        while (r.queue.length && r.id) {
          const pcm = joinPcm(r.queue.splice(0));
          const x = await api('POST', `/mic/${r.id}/audio`, undefined, { raw: new Blob([pcm.buffer]), timeout: 20000, base: r.base });
          if (rec === r && x && x.text) { r.heard = x.text; mtext.textContent = x.text; }
          if (!all) break;
        }
      } finally { r.sending = false; }
    }
    function micOff(r) { r.closed = true; clearInterval(r.tick); micLetGo(); }
    function micDrop(r) { if (r.id) api('DELETE', `/mic/${r.id}`, undefined, { base: r.base }).catch(() => {}); }
    // a piece that didn't land (a 404 = the recording is gone there; anything else = a hole in it, words would be
    // missing): carry on recording, the stop sends the whole thing. (An older computer without /mic/once: as before.)
    function pieceFailed(r, e) { if (r.once) { r.lost = true; if (r.id) micDrop(r); } else micFail(r, e); }
    function micLive(r) { // (the first sound has come in: from here on every word is kept)
      if (r.live || rec !== r) return; r.live = true;
      micline.classList.add('live'); if (!r.heard) mtext.textContent = 'Listening…';
    }
    async function micStart() {
      const r = { id: null, queue: [], all: [], seq: 0, seqMode: micSeq(), once: !!(data.hello && (data.hello.features || []).includes('miconce')) };
      rec = r; micline.classList.remove('live'); mtext.textContent = 'Starting the mic…'; paintMic();
      // The computer is asked in the background. Before (v9) the sound only started once it had answered, a second
      // or more on the Tesla's mobile data, while the strip already said "Listening…": the first words were lost.
      // Now the sound is kept from the first moment and goes to the computer once it has said yes.
      r.started = api('POST', '/mic', {}, { used: (b) => { r.base = b; } }).then((x) => {
        if (r.closed && !r.stopping) { r.id = x.id; micDrop(r); return; }
        r.id = x.id; if (!r.closed) pump(r).catch((e) => pieceFailed(r, e));
      }, (e) => { // (no computer took it just now: record anyway, the stop sends it all at once)
        if (!r.once || (e.status && e.status !== 404 && !e.offline)) { micFail(r, e); return; }
        r.lost = true;
      });
      try {
        const m = await micOpen(); // (in the tap itself the first time: iOS wants that)
        if (rec !== r) return; // (cancelled or failed meanwhile)
        for (const pcm of m.preroll()) { r.queue.push(pcm); r.all.push(pcm); } // (the moment just before the tap)
        m.listen((pcm, rms, sec) => {
          if (r.closed) return;
          r.queue.push(pcm); r.all.push(pcm); micLive(r);
          micline.style.setProperty('--lvl', Math.min(1, rms * 12).toFixed(2));
          if (r.tail) r.tail(rms, sec, m.floor);
        });
        if (m.flowing) micLive(r);
        r.tick = setInterval(() => { pump(r).catch((e) => pieceFailed(r, e)); }, 250);
      } catch (e) { micFail(r, e); }
    }
    function micFail(r, e) {
      if (rec !== r) return;
      rec = null; micOff(r); micDrop(r); paintMic();
      toast(e && e.name === 'NotAllowedError' ? 'The mic is blocked for this app. Allow the microphone when it asks (or in Settings), then try again.'
        : e && e.offline ? 'Can\'t reach your computers.' : `Mic: ${(e && e.message) || e}`, 'err');
    }
    async function micStop() {
      const r = rec; if (!r) return;
      rec = null; r.stopping = true; paintMic();
      if (!r.live) { micOff(r); micDrop(r); return; } // (the mic never opened: nothing was said)
      micBtn.disabled = true; box.placeholder = 'Writing it down…';
      let written; const writing = micWriting = new Promise((res) => { written = res; });
      const a = box.selectionStart != null ? box.selectionStart : box.value.length; const b = box.selectionEnd != null ? box.selectionEnd : a;
      const before = box.value.slice(0, a); const after = box.value.slice(b);
      const put = (t) => { // (t where the cursor was; called again to swap the words so far for Grok's final text)
        const ins = t ? (before && !/\s$/.test(before) ? ' ' : '') + t + (after && !/^\s/.test(after) ? ' ' : '') : '';
        box.value = before + ins + after;
        const c = (before + ins).length; try { box.setSelectionRange(c, c); } catch (e) {}
        lsSet(draftKey, box.value); grow();
        return box.value;
      };
      const heard = String(r.heard || '').trim();
      const shown = heard ? put(heard) : null; // (in the box at once, like F5)
      // Keep listening a moment after the tap (owner 11-12 Oct 2026 on the Tesla: the last word was cut off): a
      // browser hands the sound over late, so the last word is still on its way when the stop is tapped. The tail
      // ends once MIC_QUIET_MS of quiet has come in (the word is in), at most MIC_TAIL_MS.
      await new Promise((done) => {
        let quiet = 0;
        r.tail = (rms, sec, floor) => { quiet = rms < Math.max(0.004, (floor || 0) * 3) ? quiet + sec * 1000 : 0; if (quiet >= MIC_QUIET_MS) done(); };
        setTimeout(done, MIC_TAIL_MS);
      });
      micOff(r);
      // a little silence after the last word: Grok then hears the sentence end instead of it stopping mid-sound
      const pad = new Int16Array(16 * MIC_PAD_MS); r.queue.push(pad); r.all.push(pad);
      try {
        if (!r.id && !r.lost) await r.started; // (the computer hasn't said yes yet: wait for it, the words are all here)
        let x = null; let failed = null;
        if (!r.lost && r.id) {
          try {
            if (r.seqMode) { // (the last piece rides with the end: one trip to the computer)
              const tail = joinPcm(r.queue.splice(0));
              x = await api('POST', `/mic/${r.id}/end?seq=${r.seq++}`, undefined, { raw: new Blob([tail.buffer]), timeout: 30000, base: r.base });
            } else {
              while (r.sending) await sleep(50);
              await pump(r, true);
              x = await api('POST', `/mic/${r.id}/end`, {}, { timeout: 30000, base: r.base });
            }
          } catch (e) { failed = e; }
        } else if (!r.lost) failed = new Error('The mic didn\'t start on your computer. Try again.');
        // the live recording was lost or broke: the whole of it, once, to whichever computer answers
        if ((r.lost || failed) && r.once && r.all.length && !(failed && /out of usage/.test(failed.message || ''))) {
          box.placeholder = 'Writing it down (sending it all)…';
          x = await api('POST', '/mic/once', undefined, { raw: new Blob([joinPcm(r.all).buffer]), timeout: 120000 });
        } else if (failed) throw failed;
        const t = String((x && x.text) || '').trim();
        if (shown != null && box.value !== shown) return; // (typed in the box meanwhile: leave it)
        if (!t && shown == null) { toast('Heard nothing.'); return; }
        put(t || heard);
      } catch (e) { toast(e.offline ? `Can't reach your computers. ${shown != null ? 'The words so far are in the box.' : 'Nothing was written down.'}` : e.message, 'err'); }
      finally { micBtn.disabled = false; box.placeholder = 'Message'; if (micWriting === writing) micWriting = null; written(); }
    }
    // keep a Grok mic ready on the computer while this chat is on screen (no ~1 s connect after the tap, lib/phonemic.js)
    const micWarm = () => { if (!document.hidden && !micBtn.hidden && data.hello && (data.hello.features || []).includes('micwarm')) api('POST', '/mic/warm', {}).catch(() => {}); };
    const warmTick = setInterval(micWarm, 35000); setTimeout(micWarm, 300);
    const onVis = () => { if (!document.hidden) micWarm(); }; document.addEventListener('visibilitychange', onVis);
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
      // Send right after the mic (or while it still listens) sends the WHOLE sentence, like Enter after F5 on the Mac
      // (owner 11 Oct 2026: "I can literally click enter right away without even checking the words").
      if (rec) micStop();
      if (micWriting) { sendBtn.disabled = true; await micWriting; }
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
        let r;
        try { r = await api('POST', `/sessions/${encodeURIComponent(id)}/prompt`, { text, ...(photos.length ? { photos } : {}) }); } catch (e) {
          // (the computer forgot the photos: restarted for an update, or the phone switched Mac ↔ Windows: up again, once)
          if (!photos.length || !/photo was lost/i.test(e.message || '')) throw e;
          await Promise.all(sent.map(upload));
          if (sent.some((x) => x.state !== 'ok')) throw new Error('a photo didn\'t make it. Remove it (✕) or add it again.');
          r = await api('POST', `/sessions/${encodeURIComponent(id)}/prompt`, { text, photos: sent.map((x) => x.photoId) });
        }
        p.status = r && r.queued ? 'queued' : 'sent';
        if (r && r.movedTo) { follow(r.movedTo); return; }
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
        toast(e.offline ? 'Can\'t reach your computers. Your message is still in the box.' : `Not sent: ${e.message}`, 'err');
      }
    }

    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="back"]')) back('#/'); });

    // ----- swipe right from anywhere = the back arrow (owner 8 Oct: thumb-friendly, start mid-screen) -----
    // Not from the box, a sheet, or something that can still scroll left (a wide code block / the terminal).
    {
      let sw = null;
      const canScrollLeft = (n) => { for (; n && n !== el; n = n.parentElement) if (n.scrollLeft > 0 && n.scrollWidth > n.clientWidth) return true; return false; };
      el.addEventListener('touchstart', (e) => {
        sw = null;
        if (e.touches.length !== 1 || curSheet || closing) return;
        const t = e.target;
        if (t.closest('textarea, input, select, .sheet, .jump') || canScrollLeft(t)) return;
        sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false, dx: 0, trail: [] };
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!sw) return;
        const dx = e.touches[0].clientX - sw.x; const dy = e.touches[0].clientY - sw.y;
        if (!sw.on) {
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // (scrolling the chat)
          if (dx > 14 && dx > Math.abs(dy) * 1.5) { sw.on = true; el.style.transition = 'none'; } else return;
        }
        e.preventDefault();
        sw.dx = Math.max(0, dx);
        const now = Date.now(); sw.trail.push({ dx: sw.dx, t: now }); while (sw.trail.length > 2 && now - sw.trail[0].t > 100) sw.trail.shift(); // (speed over the last 0.1 s)
        el.style.transform = `translateX(${sw.dx}px)`;
      }, { passive: false });
      const done = () => {
        if (!sw || !sw.on) { sw = null; return; }
        const f = sw.trail[0] || { dx: 0, t: Date.now() - 1 };
        const fast = sw.dx > 40 && (sw.dx - f.dx) / Math.max(1, Date.now() - f.t) > 0.5; // (a flick)
        const go = sw.dx > Math.min(120, el.clientWidth * 0.3) || fast;
        sw = null;
        el.style.transition = 'transform .18s ease-out';
        el.style.transform = go ? 'translateX(100%)' : '';
        if (go) setTimeout(() => back('#/'), 150);
        else setTimeout(() => { el.style.transition = ''; }, 200);
      };
      el.addEventListener('touchend', done);
      el.addEventListener('touchcancel', () => { if (sw && sw.on) { sw.dx = 0; } done(); });
    }

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
        if (!lock()) h += actRow('duplicate', I.copy2, 'Duplicate', { sub: 'A new, empty session of the same kind here' });
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
          const run = async (fn) => { busy = true; b.classList.add('busy'); try { await fn(); } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : err.message, 'err'); } busy = false; b.classList.remove('busy'); };
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
          } catch (err) { sw.checked = !sw.checked; toast(err.offline ? 'Can\'t reach your computers' : err.message, 'err'); }
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
        micRelease(mic);
        clearInterval(warmTick); document.removeEventListener('visibilitychange', onVis);
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
        <div class="brandrow"><h1>Folders</h1><button class="ibtn" data-act="newfolder" data-feat="newfolder" aria-label="New folder">${I.plus}</button>${connPill()}</div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="scroll can-stale"><div class="body"></div></div>
      ${tabbar('folders')}`);
    const body = $('.body', el);
    let unwatch = () => {};
    let fl = null;
    function render() {
      if (!data.folders) { body.innerHTML = '<div class="glabel">&nbsp;</div><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; return; }
      if (!data.folders.length) { body.innerHTML = `<div class="empty"><b>No folders yet</b>Folders you use in FoxyMind show up here.${has('newfolder') ? '<button class="btn secondary" data-act="newfolder">New folder</button>' : ''}</div>`; return; }
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
    // + : a new project folder (in ~/Projects, or on the Desktop), then its page to start a chat in it
    function newFolder() {
      let where = 'projects'; let making = false;
      const whereRow = () => `<div class="mlab">Where</div><div class="mrow">${[['projects', 'Projects'], ['desktop', 'Desktop']].map(([k, l]) => `<button type="button" data-where="${k}" class="${k === where ? 'on' : ''}" aria-pressed="${k === where}">${l}</button>`).join('')}</div>`;
      const sh = sheet({
        title: 'New folder', sub: 'For a new project, on your computers too',
        html: `<form class="rename"><input class="rin" type="text" maxlength="80" placeholder="Project name" aria-label="Folder name" enterkeyhint="done" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="mpick fwhere">${whereRow()}</div><p class="ferr small" hidden></p><button type="submit" class="btn primary">Make folder</button></form>`,
        onClick(e) { const w = e.target.closest('[data-where]'); if (w && !making) { where = w.dataset.where; $('.fwhere', sh.body).innerHTML = whereRow(); } },
      });
      const f = $('form', sh.body); const inp = $('.rin', sh.body); const err = $('.ferr', sh.body); const btn = $('button[type="submit"]', sh.body);
      setTimeout(() => inp.focus(), 60);
      inp.addEventListener('input', () => { err.hidden = true; });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const name = inp.value.trim();
        if (!name) { inp.focus(); return; }
        if (making) return;
        making = true; btn.innerHTML = '<span class="spin"></span>Making…';
        try {
          const r = await api('POST', '/folders', { name, where }, { timeout: 30000 });
          data.folders = null; // (its page reads the list again, with the new folder in it)
          sh.close(); toast(r.existing ? 'That folder was already here' : `Made ${r.name}`);
          go(`#/f/${encodeURIComponent(r.folderId)}`, 'push');
        } catch (e2) {
          making = false; btn.textContent = 'Make folder';
          err.textContent = e2.offline ? 'Can\'t reach your computers' : e2.message; err.hidden = false; inp.focus();
        }
      });
    }
    body.addEventListener('click', (e) => { const a = e.target.closest('a.frow'); if (a) { e.preventDefault(); go(a.getAttribute('href'), 'push'); } });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act="newfolder"]')) newFolder(); });
    return {
      el,
      mounted() { unwatch = watchBars(el); paintFeatures(el); render(); fl = loop(fetchFolders, 10000); },
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
        <div class="fpick">${pickerHtml(newChat().model, newChat().effort)}</div>
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
    const start = newChat(); // what the new chat opens on (Opus 5.5 at medium each time, unless picked here)

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
          toast(err.offline ? 'Can\'t reach your computers' : `Couldn't start: ${err.message}`, 'err');
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
          toast(err.offline ? 'Can\'t reach your computers' : `Couldn't start: ${err.message}`, 'err');
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
        toast(err.offline ? 'Can\'t reach your computers' : `Couldn't resume: ${err.message}`, 'err');
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
    const over = !!(w && w.resetsAt && w.resetsAt <= Date.now()); // (an old reading whose window has already reset: full again)
    const used = w && w.usedPercent != null ? (over ? 0 : Math.max(0, Math.min(100, Number(w.usedPercent)))) : null;
    const left = used == null ? null : Math.round(100 - used);
    const lvl = left == null ? '' : left <= 0 ? 'zero' : left < 10 ? 'low' : left < 25 ? 'mid' : '';
    const reset = w && w.resetsAt && !over ? `resets ${until(w.resetsAt)}` : '';
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
      try { data.usage = await api('POST', '/usage/refresh', {}, { timeout: 30000 }); err = null; } catch (e) { toast(e.offline ? 'Can\'t reach your computers' : `Couldn't refresh: ${e.message}`, 'err'); }
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
        } catch (er) { sk.disabled = false; toast(er.offline ? 'Can\'t reach your computers' : er.message, 'err'); }
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
    let pcode = null; // (a short pair code for another screen: { code, expiresAt })

    function notifSection() {
      const h = data.hello;
      const dev = (h && h.device) || {};
      const nt = Object.assign({ captcha: true }, dev.notify || { blue: true, ask: true, away: false });
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
            + (has('captcha') ? sw('captcha', 'A robot check needs me', 'Any computer, even while you\'re at the Mac') : '')
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
      // two ways in: this phone's own link to each computer (the one in use, and the other as it last answered)
      const ways = baseOf('pc') && !store.devBase ? ['mac', 'pc'].filter(baseOf).map((r) => {
        const used = routeNow() === r; const reach = conn.reach ? conn.reach[r] : undefined;
        const on = used ? conn.state === 'online' : reach === true;
        const val = used ? (conn.state === 'online' ? 'In use' : state) : reach === true ? 'Ready' : reach === false ? 'Can\'t be reached' : 'Standing by';
        return `<div class="lrow"><span class="mdot${on ? ' on' : ''}"></span><span class="grow">Through ${esc(r === 'pc' ? store.pcName || 'Windows' : store.macName || 'Mac')}</span><span class="val">${val}</span></div>`;
      }).join('') : null;
      return `<div class="glabel">Connection</div><div class="list">
        ${ways != null ? ways : rows.map((m) => {
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
        ${has('paircode') ? `<div class="glabel">Other screens</div>
        <div class="list">${pcode && pcode.expiresAt > Date.now() ? `<div class="lrow pcoderow"><span class="grow"><span class="pcode">${esc(pcode.code)}</span><small>On the other screen, open <b>nightmewfoxy.github.io/foxymind-phone</b> and type this code. Works once, until ${esc(clock(pcode.expiresAt))}.</small></span></div>` : ''}
          <button class="lrow btnrow-l" style="width:100%" data-act="paircode">${busy === 'code' ? 'Getting a code…' : pcode ? 'Get a new code' : 'Pair another screen'}</button></div>
        <p class="gfoot">For your car, a tablet or any browser: type a short code there instead of a link.</p>` : ''}
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
      if (act === 'paircode') {
        if (busy) return;
        busy = 'code'; render();
        try { pcode = await api('POST', '/paircode'); } catch (err) { toast(`Couldn't get a code: ${err.message}`, 'err'); }
        busy = ''; render();
        const pr = $('.pcoderow', body); if (pr && pr.scrollIntoView) pr.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
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
      const nt = Object.assign({ blue: true, ask: true, away: false, captcha: true }, (data.hello && data.hello.device && data.hello.device.notify) || {});
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

  // ======================================================================================
  // A robot check (owner 8 Oct 2026: "for captchas on windows … access it in foxymind ios to solve the captcha"):
  // the tab live (a picture of the part shown, a few times a second); one finger is the mouse there (tap, or drag a
  // slider: every point goes with its own timing, so the page sees his real movement), two fingers move and zoom the
  // picture. Typing goes into whatever he tapped. Nothing is ever clicked for him (lib/captchaview.js).
  // ======================================================================================
  function CaptchaView(machine, cid) {
    const base = `/captchas/${encodeURIComponent(machine)}/${encodeURIComponent(cid)}`;
    let meta = (data.captchas || []).find((c) => c.id === cid && (c.machine || 'mac') === machine) || null;
    const el = screenEl('cv', `
      <header class="topbar">
        <div class="navrow">
          <button class="back" data-act="back" aria-label="Back">${I.back}</button>
          <div class="ttl"><div class="t1">Robot check</div><div class="t2"></div></div>
          <span class="cvlive"><i></i><span>Connecting…</span></span>
        </div>
        <div class="offline-slot">${offlineBanner()}</div>
      </header>
      <div class="cvstage" aria-label="The check, live"><img class="cvimg" alt="" draggable="false"><div class="cvdot" hidden></div><div class="cvmsg" hidden></div><div class="cvdone" hidden></div></div>
      <footer class="botbar cvbot">
        <div class="cvhint">One finger is the mouse: tap, or drag the slider. Two fingers move and zoom the picture.</div>
        <div class="cvtype" hidden><input class="cvin" type="text" placeholder="Text to type into the page" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" aria-label="Text to type"><button class="btn-sm" data-act="tsend">Type</button><button class="btn-sm" data-act="kenter" aria-label="Enter key">⏎</button><button class="btn-sm" data-act="kback" aria-label="Delete key">⌫</button></div>
        <div class="cvtools">
          <button type="button" data-act="zbox">${I.zoomin}<span>Zoom on check</span></button>
          <button type="button" data-act="zall">${I.expand}<span>Whole tab</span></button>
          <button type="button" data-act="kbd" aria-pressed="false">${I.kbd}<span>Type</span></button>
          <button type="button" data-act="later">${I.close}<span>Not now</span></button>
        </div>
      </footer>`);
    const stage = $('.cvstage', el); const img = $('.cvimg', el); const dot = $('.cvdot', el);
    const msg = $('.cvmsg', el); const doneEl = $('.cvdone', el); const liveEl = $('.cvlive', el); const t2 = $('.t2', el);
    const typeRow = $('.cvtype', el); const tin = $('.cvin', el);
    let alive = true; let status = 'open';
    let vp = null; let box = null; let want = null; let shown = null;
    let reqSeq = 0; let paintedSeq = 0; const paints = [];
    let pinch = null; let finger = null; let unwatch = () => {};

    function paintMeta() {
      const m = meta || {};
      t2.textContent = [m.siteName, m.chrome, m.where || (machine === 'mac' ? (store.macName || 'Mac') : 'Windows')].filter(Boolean).join(' · ');
    }
    function setLive(text, cls) { liveEl.className = `cvlive ${cls || ''}`; $('span', liveEl).textContent = text; }
    function showMsg(t) { msg.textContent = t; msg.hidden = !t; }
    const stageBox = () => { const b = stage.getBoundingClientRect(); return { w: b.width, h: b.height, l: b.left, t: b.top }; };
    // a part of the tab shaped like the stage (so the picture fills it), inside the tab
    function fit(r) {
      if (!vp) return r;
      const S = stageBox(); const a = S.w / Math.max(1, S.h);
      let w = Math.max(60, r.w); let h = Math.max(40, r.h);
      const cx = r.x + r.w / 2; const cy = r.y + r.h / 2;
      if (w / h < a) w = h * a; else h = w / a;
      if (w > vp.w) { w = vp.w; h = w / a; }
      if (h > vp.h) { h = vp.h; w = Math.min(vp.w, h * a); }
      return { x: Math.max(0, Math.min(vp.w - w, cx - w / 2)), y: Math.max(0, Math.min(vp.h - h, cy - h / 2)), w, h };
    }
    function place() {
      if (!shown) return;
      const S = stageBox(); const r = shown.region;
      const k = Math.min(S.w / r.w, S.h / r.h); const dw = r.w * k; const dh = r.h * k;
      shown.k = k; shown.ox = (S.w - dw) / 2; shown.oy = (S.h - dh) / 2;
      Object.assign(img.style, { width: `${dw}px`, height: `${dh}px`, left: `${shown.ox}px`, top: `${shown.oy}px` });
    }
    function paint(f) {
      return new Promise((ok) => {
        const im = new Image();
        im.onload = im.onerror = () => {
          if (!alive) return ok();
          img.src = im.src; shown = { region: f.region }; place();
          if (!pinch) img.style.transform = '';
          img.classList.add('on');
          ok();
        };
        im.src = `data:image/jpeg;base64,${f.img}`;
      });
    }
    function toPage(cx, cy) {
      if (!shown || !shown.k) return null;
      const S = stageBox();
      const x = shown.region.x + (cx - S.l - shown.ox) / shown.k; const y = shown.region.y + (cy - S.t - shown.oy) / shown.k;
      if (!vp) return { x, y };
      return { x: Math.max(0, Math.min(vp.w - 1, x)), y: Math.max(0, Math.min(vp.h - 1, y)) };
    }
    function onStatus(f) {
      if (!f || !f.status || f.status === status) return;
      status = f.status;
      if (status === 'open') return;
      const t = status === 'solved' ? ['Solved', 'The job waiting on it carries on by itself.', 'ok']
        : status === 'dismissed' ? ['Set aside', 'The job waiting on it stops that part.', '']
          : ['It went away', 'The tab with the check was closed.', ''];
      doneEl.innerHTML = `<div class="cvdbox ${t[2]}">${t[2] ? `<span class="cvtick">${I.check}</span>` : ''}<b>${t[0]}${t[2] ? ' ✓' : ''}</b><span>${t[1]}</span><button class="btn secondary" data-act="back">Back to sessions</button></div>`;
      doneEl.hidden = false; showMsg('');
      setLive(status === 'solved' ? 'Solved' : 'Closed', status === 'solved' ? 'ok' : 'off');
      if (cvLoop) cvLoop.kick();
    }
    async function frameLoop() {
      while (alive && status === 'open') {
        if (document.hidden) { await sleep(600); continue; }
        const my = ++reqSeq; const S = stageBox();
        const q = want ? `x=${Math.round(want.x)}&y=${Math.round(want.y)}&w=${Math.round(want.w)}&h=${Math.round(want.h)}&` : '';
        const px = Math.round(Math.max(320, Math.min(1400, S.w * (window.devicePixelRatio || 2))));
        try {
          const f = await api('GET', `${base}/frame?${q}px=${px}&q=${finger || pinch ? 50 : 62}`, undefined, { timeout: 15000 });
          if (!alive) return;
          onStatus(f);
          if (f.status && f.status !== 'open') return;
          if (f.viewport) vp = f.viewport;
          if (f.box !== undefined) box = f.box;
          if (!want && vp) want = fit(box || { x: 0, y: 0, w: vp.w, h: vp.h }); // (first look: zoomed on the check)
          if (f.img && my > paintedSeq) {
            paintedSeq = my; await paint(f);
            const now = Date.now(); paints.push(now); while (paints.length && now - paints[0] > 3000) paints.shift();
            setLive(`Live · ${Math.max(1, Math.round(paints.length / 3))}/s`, 'on');
          }
          showMsg('');
        } catch (e) {
          if (!alive) return;
          if (e.status === 404) { onStatus({ status: 'gone' }); return; }
          setLive('Reconnecting…', 'off');
          showMsg(e.offline ? 'Can\'t reach your computers right now. Trying again…' : e.message || 'Something went wrong. Trying again…');
          await sleep(1500);
        }
      }
    }

    // ----- his finger -> the page's mouse (pieces of a drag go every 50 ms, each point with its time) -----
    const send = (path, body) => api('POST', `${base}${path}`, body, { timeout: 10000 });
    function flush(f) {
      if (!f || !f.pending.length) return;
      const events = f.pending.splice(0);
      send('/input', { g: f.g, seq: f.seq++, events }).then((r) => { if (r && r.status) onStatus(r); }).catch((e) => { if (e.status === 404) onStatus({ status: 'gone' }); else toast(e.offline ? 'Can\'t reach your computers' : e.message, 'err'); });
    }
    function showDot(cx, cy, on) {
      const S = stageBox();
      dot.style.transform = `translate(${cx - S.l}px, ${cy - S.t}px)`;
      dot.hidden = false; dot.classList.toggle('on', !!on);
    }
    function startFinger() {
      const f = finger; if (!f || f.started) return;
      f.started = true; clearTimeout(f.wait); flush(f);
      f.iv = setInterval(() => flush(f), 50);
    }
    function endFinger(cx, cy) {
      const f = finger; if (!f) return; finger = null;
      const p = toPage(cx, cy) || f.last;
      f.pending.push({ type: 'up', x: p.x, y: p.y, t: Math.round(performance.now() - f.t0) });
      f.started = true; clearTimeout(f.wait); clearInterval(f.iv); flush(f);
      dot.classList.remove('on'); setTimeout(() => { if (!finger) dot.hidden = true; }, 350);
    }
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
    function startPinch(a, b) {
      if (!shown || !shown.k) return;
      const m = mid(a, b);
      pinch = { d0: Math.max(10, dist(a, b)), m0: m, m, s: 1, p0: toPage(m.x, m.y), k: shown.k, ox: shown.ox, oy: shown.oy, region: shown.region };
      img.style.transformOrigin = '0 0';
    }
    function movePinch(a, b) {
      const P = pinch; if (!P || !P.p0) return;
      const S = stageBox(); const m = mid(a, b);
      const minK = vp ? Math.min(S.w / vp.w, S.h / vp.h) : 0.1; const maxK = S.w / 60;
      P.s = Math.max(minK / P.k, Math.min(maxK / P.k, dist(a, b) / P.d0)); P.m = m;
      const u0 = (P.p0.x - P.region.x) * P.k; const v0 = (P.p0.y - P.region.y) * P.k;
      const tx = m.x - S.l - P.ox - u0 * P.s; const ty = m.y - S.t - P.oy - v0 * P.s;
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${P.s})`;
    }
    function endPinch() {
      const P = pinch; pinch = null; if (!P || !P.p0 || !vp) return;
      const S = stageBox(); const k = P.k * P.s;
      want = fit({ x: P.p0.x - (P.m.x - S.l) / k, y: P.p0.y - (P.m.y - S.t) / k, w: S.w / k, h: S.h / k });
    }
    stage.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (status !== 'open') return;
      const ts = e.touches;
      if (ts.length >= 2) {
        if (finger && !finger.started) { clearTimeout(finger.wait); finger = null; dot.hidden = true; } // (two fingers landing: a zoom, not a click)
        if (!finger && !pinch) startPinch(ts[0], ts[1]);
        return;
      }
      if (pinch || finger) return;
      const t = e.changedTouches[0]; const p = toPage(t.clientX, t.clientY);
      if (!p) return;
      finger = { id: t.identifier, g: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, seq: 0, t0: performance.now(), pending: [{ type: 'down', x: p.x, y: p.y, t: 0 }], started: false, last: p };
      finger.wait = setTimeout(startFinger, 90); // (a second finger within 90 ms makes it a zoom)
      showDot(t.clientX, t.clientY, true);
    }, { passive: false });
    stage.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (pinch && e.touches.length >= 2) { movePinch(e.touches[0], e.touches[1]); return; }
      const f = finger; if (!f) return;
      const t = [...e.changedTouches].find((x) => x.identifier === f.id); if (!t) return;
      const p = toPage(t.clientX, t.clientY); if (!p) return;
      if (Math.abs(p.x - f.last.x) < 0.5 && Math.abs(p.y - f.last.y) < 0.5) return;
      f.pending.push({ type: 'move', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, t: Math.round(performance.now() - f.t0) });
      f.last = p; showDot(t.clientX, t.clientY, true);
    }, { passive: false });
    const touchEnd = (e) => {
      e.preventDefault();
      if (pinch) { if (e.touches.length < 2) endPinch(); return; }
      const f = finger; if (!f) return;
      const t = [...e.changedTouches].find((x) => x.identifier === f.id); if (!t) return;
      endFinger(t.clientX, t.clientY);
    };
    stage.addEventListener('touchend', touchEnd, { passive: false });
    stage.addEventListener('touchcancel', touchEnd, { passive: false });
    // (a computer's mouse, for testing in a desktop browser: the same path)
    stage.addEventListener('mousedown', (e) => {
      if (status !== 'open' || e.button !== 0) return;
      const p = toPage(e.clientX, e.clientY); if (!p) return;
      finger = { id: 'mouse', g: `${Date.now().toString(36)}m`, seq: 0, t0: performance.now(), pending: [{ type: 'down', x: p.x, y: p.y, t: 0 }], started: false, last: p };
      startFinger(); showDot(e.clientX, e.clientY, true);
    });
    window.addEventListener('mousemove', function mm(e) {
      if (!alive) { window.removeEventListener('mousemove', mm); return; }
      const f = finger; if (!f || f.id !== 'mouse') return;
      const p = toPage(e.clientX, e.clientY); if (!p) return;
      f.pending.push({ type: 'move', x: p.x, y: p.y, t: Math.round(performance.now() - f.t0) }); f.last = p; showDot(e.clientX, e.clientY, true);
    });
    window.addEventListener('mouseup', function mu(e) {
      if (!alive) { window.removeEventListener('mouseup', mu); return; }
      if (finger && finger.id === 'mouse') endFinger(e.clientX, e.clientY);
    });

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'back') back('#/');
      else if (act === 'zbox') { if (!vp) return; if (!box) toast('Couldn\'t find the check on the page; here is the whole tab.'); want = fit(box || { x: 0, y: 0, w: vp.w, h: vp.h }); }
      else if (act === 'zall') { if (vp) want = fit({ x: 0, y: 0, w: vp.w, h: vp.h }); }
      else if (act === 'kbd') { typeRow.hidden = !typeRow.hidden; b.setAttribute('aria-pressed', String(!typeRow.hidden)); if (!typeRow.hidden) tin.focus(); }
      else if (act === 'tsend') typeIt();
      else if (act === 'kenter' || act === 'kback') { try { await send('/key', { key: act === 'kenter' ? 'Enter' : 'Backspace' }); } catch (err) { toast(err.message, 'err'); } }
      else if (act === 'later') {
        if (!confirm('Set this robot check aside? The job waiting on it stops that part.')) return;
        try { await send('/dismiss', {}); onStatus({ status: 'dismissed' }); } catch (err) { toast(err.message, 'err'); }
      }
    });
    async function typeIt() {
      const text = tin.value; if (!text) return;
      try { await send('/type', { text }); tin.value = ''; toast('Typed into the page'); } catch (err) { toast(err.offline ? 'Can\'t reach your computers' : err.message, 'err'); }
    }
    tin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typeIt(); } });

    paintMeta();
    return {
      el,
      mounted() {
        const unbars = watchBars(el);
        const ro = window.ResizeObserver ? new ResizeObserver(() => place()) : null; if (ro) ro.observe(stage);
        unwatch = () => { unbars(); if (ro) ro.disconnect(); };
        api('GET', base).then((m) => { meta = m; paintMeta(); onStatus(m); }).catch((e) => { if (e.status === 404) onStatus({ status: 'gone' }); });
        frameLoop(); setTimeout(() => { if (alive) frameLoop(); }, 180); // (two pictures on the way at once: more of them per second)
      },
      onViewport() { place(); },
      destroy() { alive = false; unwatch(); if (finger) { clearTimeout(finger.wait); clearInterval(finger.iv); } },
    };
  }

  // ---------- her folder's pictures in replies (img.fpic, see renderParts): fetched with the phone's key, kept ----------
  const picUrls = new Map(); // file → blob url | Promise
  function loadPics() {
    for (const img of $$('img.fpic:not([src])')) {
      const f = img.dataset.file; const got = picUrls.get(f);
      if (typeof got === 'string') { img.src = got; continue; }
      if (got) continue;
      picUrls.set(f, api('GET', `/file?path=${encodeURIComponent(f)}`, undefined, { blob: true, timeout: 60000 })
        .then((b) => { const u = URL.createObjectURL(b); picUrls.set(f, u); $$('img.fpic:not([src])').filter((x) => x.dataset.file === f).forEach((x) => { x.src = u; }); },
          () => { picUrls.delete(f); }));
    }
  }
  new MutationObserver(() => { if (document.querySelector('img.fpic:not([src])')) loadPics(); }).observe(document.body, { childList: true, subtree: true });

  // ---------- a new version while the app stays open (owner 26 Oct 2026, his mother's Android: "make it so that she can
  // reopen the app and see it updated"). Android keeps the app running in the background, so reopening it doesn't load
  // anything new: on every return (and every 15 min) version.json is checked past every cache, and a newer app loads
  // itself, unless something is being typed or recorded. ----------
  let verAt = 0;
  async function checkVersion() {
    if (Date.now() - verAt < 60000) return; verAt = Date.now();
    try {
      const v = await (await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
      if (!v || !v.v || String(v.v) === APP_VERSION) return;
      const busy = [...document.querySelectorAll('textarea, input[type=text]')].some((x) => x.value && x.value.trim()) || document.querySelector('.micbtn.on, .shot.up');
      if (busy) return;
      try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* fine */ }
      location.reload();
    } catch (e) { /* offline: next time */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
  setInterval(() => { if (document.visibilityState === 'visible') checkVersion(); }, 15 * 60000);

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* fine without it */ });
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'open') go(d.hash && /^#\/cv\//.test(d.hash) ? d.hash : d.sessionId ? `#/s/${encodeURIComponent(d.sessionId)}` : '#/', 'push');
    });
  }

  fitViewport();
  zhApply();
  route();
  window.__fm = { store: () => store, data, conn, zhApply, zhText }; // (for debugging from the console)
})();
