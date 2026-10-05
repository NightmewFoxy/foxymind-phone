// (Copied from foxymind/public/md.js so the phone renders replies the same way as the desktop.)
// Minimal, safe markdown -> HTML (escapes everything first). Enough for agent replies.
// Safety: every piece of the source is escaped; the only tags that come out are the ones written
// here, and links only ever point at http(s)/mailto (no javascript:, no remote images).
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SAFE_URL = /^(https?:\/\/|mailto:)/i;

  function inline(s) {
    const kept = []; // finished HTML (code, links) parked behind \0N\0 so later rules can't touch it
    const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
    s = s.replace(/``(.+?)``|`([^`\n]+)`/g, (_, a, b) => keep(`<code>${esc(a != null ? a.trim() : b)}</code>`));
    // images become links (never load remote pictures); unsafe schemes stay plain text
    s = s.replace(/(!?)\[([^\]\n]+)\]\(([^()\s]+)(?:\s+"[^"\n]*")?\)/g, (m, img, text, url) => (SAFE_URL.test(url)
      ? keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${img ? 'Image: ' : ''}${emph(esc(text))}</a>`) : m));
    // bare URLs; trailing punctuation belongs to the sentence
    s = s.replace(/(^|[\s(["'<])(https?:\/\/[^\s<>"'`\u0000]*[^\s<>"'`\u0000.,:;!?)\]])/g, (_, pre, url) => pre + keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`));
    s = emph(esc(s));
    while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
    return s;
  }
  // Emphasis only where markdown means it: "5 * 3 * 2", 2**10 and snake_case stay as written.
  function emph(s) {
    return s.replace(/(^|[^\w*])\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w_])__(?=\S)([^_\n]*?\S)__(?![\w_])/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
  }

  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>/;
  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const isTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1]);
  const indentOf = (l) => l.search(/\S|$/);
  const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEADING.test(lines[i]) || HR.test(lines[i]) || QUOTE.test(lines[i]) || LIST.test(lines[i]) || isTable(lines, i);

  function code(text, lang) {
    const l = lang.toLowerCase();
    const body = l === 'diff' || l === 'patch'
      ? esc(text).split('\n').map((x) => (/^\+/.test(x) && !/^\+\+\+/.test(x) ? `<span class="add">${x}</span>` : /^-/.test(x) && !/^---/.test(x) ? `<span class="del">${x}</span>` : /^@@/.test(x) ? `<span class="hunk">${x}</span>` : x)).join('\n')
      : esc(text);
    return `<pre class="code"${l ? ` data-lang="${esc(l)}"` : ''}><button type="button" class="copy" title="Copy">Copy</button><code>${body}</code></pre>`;
  }

  function table(lines, i) {
    const cells = (r) => r.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1').replace(/\\\|/g, '\u0001').split('|').map((c) => c.trim().replace(/\u0001/g, '|'));
    const head = cells(lines[i]);
    const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
    const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c || '')}</${tag}>`;
    i += 2;
    const body = [];
    while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE.test(lines[i])) body.push(cells(lines[i++]));
    const html = `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${head.map((_, k) => td('td', r[k], k)).join('')}</tr>`).join('')}</tbody></table></div>`;
    return [html, i];
  }

  // One list (items at the same level); deeper-indented lines belong to the item above them.
  function list(lines, i) {
    const m0 = lines[i].match(LIST);
    const base = m0[1].length;
    const ordered = /\d/.test(m0[2]);
    const items = [];
    let loose = false;
    while (i < lines.length) {
      const l = lines[i];
      const m = l.match(LIST);
      if (m && m[1].length <= base + 1 && /\d/.test(m[2]) === ordered) {
        items.push({ lines: [m[4]], indent: m[1].length + m[2].length + Math.max(1, Math.min(m[3].length, 4)) });
        i++; continue;
      }
      if (!l.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length) break;
        const mj = lines[j].match(LIST);
        const sibling = mj && mj[1].length <= base + 1 && /\d/.test(mj[2]) === ordered;
        if (sibling || indentOf(lines[j]) >= base + 2) { loose = loose || sibling; items[items.length - 1].lines.push(''); i = j; continue; }
        break;
      }
      const cur = items[items.length - 1];
      if (indentOf(l) >= base + 2) { cur.lines.push(l.slice(Math.min(cur.indent, indentOf(l)))); i++; continue; }
      // a plain line right under an item continues it (lazy continuation), unless it starts something else
      if (!m && !startsBlock(lines, i) && cur.lines[cur.lines.length - 1].trim()) { cur.lines.push(l.trim()); i++; continue; }
      break;
    }
    const tag = ordered ? 'ol' : 'ul';
    const start = ordered ? parseInt(m0[2], 10) : 1;
    const lis = items.map((it) => {
      let task = '';
      const tm = it.lines[0].match(/^\[([ xX])\]\s+/);
      if (tm) { task = tm[1] === ' ' ? '<span class="task">☐</span>' : '<span class="task done">☑</span>'; it.lines[0] = it.lines[0].slice(tm[0].length); }
      let body = blocks(it.lines);
      if (!loose) body = body.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return `<li${task ? ' class="task-item"' : ''}>${task}${body}</li>`;
    }).join('');
    return [`<${tag}${start !== 1 ? ` start="${start}"` : ''}>${lis}</${tag}>`, i];
  }

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m = l.match(FENCE);
      if (m) {
        const close = new RegExp(`^\\s{0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`);
        const pad = indentOf(l);
        const buf = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) { const x = lines[i++]; buf.push(x.slice(Math.min(pad, indentOf(x)))); }
        i++;
        out.push(code(buf.join('\n'), m[2]));
        continue;
      }
      m = l.match(HEADING);
      if (m) { const lv = Math.min(m[1].length + 1, 5); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); i++; continue; }
      if (HR.test(l)) { out.push('<hr>'); i++; continue; }
      if (QUOTE.test(l)) {
        const buf = [];
        while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && buf.length && buf[buf.length - 1].trim() && !startsBlock(lines, i)))) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push(`<blockquote>${blocks(buf)}</blockquote>`);
        continue;
      }
      if (isTable(lines, i)) { const [html, next] = table(lines, i); out.push(html); i = next; continue; }
      if (LIST.test(l) && l.match(LIST)[4].trim()) { const [html, next] = list(lines, i); out.push(html); i = next; continue; }
      const para = [l];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++]);
      out.push(`<p>${inline(para.map((x) => x.trim()).join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return out.join('');
  }

  function render(src) {
    return blocks(String(src || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  }

  window.md = { render, esc };
})();
