/* Kanji Lookup — vanilla JS, no build step. Data: KANJIDIC2, JMdict (EDRDG, CC BY-SA 4.0), KanjiVG (CC BY-SA 3.0). */
(function () {
  'use strict';
  var STORE_KEY = 'kanjiLookup.v1';
  var THEME_KEY = 'kanjiLookup.theme';
  var HISTORY_CAP = 500;
  var $ = function (s) { return document.querySelector(s); };
  var DATA = [], BY = {}, current = null, view = 'search', favGroup = 'all';
  var strokeCache = {};

  /* ---------- kana / romaji ---------- */
  var KR = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko','が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no','は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo','ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po','ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo','ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','ゐ':'i','ゑ':'e','を':'o','ん':'n','ゔ':'vu',
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゃ':'ya','ゅ':'yu','ょ':'yo','ゎ':'wa'
  };
  function toHira(s) { return s.replace(/[\u30a1-\u30f6]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  function romaji(input) {
    var s = toHira(input), out = '', i, c, n, r;
    for (i = 0; i < s.length; i++) {
      c = s[i]; n = s[i + 1];
      if (c === 'っ') {
        var nx = romaji(s.slice(i + 1, i + 3)).charAt(0);
        if (/[bcdfghjkmpqrstvwz]/.test(nx)) out += (nx === 'c' ? 't' : nx);
        continue;
      }
      if (c === 'ー') { out += out.slice(-1).replace(/[^aeiou]/, ''); continue; }
      if (n && /[ゃゅょ]/.test(n) && KR[c] && /i$/.test(KR[c])) {
        var base = KR[c].slice(0, -1), y = KR[n];
        if (/(sh|ch|j)$/.test(base)) y = y.slice(1);
        out += base + y; i++; continue;
      }
      if (n && /[ぁぃぅぇぉ]/.test(n) && KR[c]) { out += KR[c].replace(/[aeiou]$/, '') + KR[n]; i++; continue; }
      r = KR[c];
      if (c === 'ん' && n && /[あいうえおやゆよ]/.test(n)) r = "n'";
      out += (r === undefined ? c : r);
    }
    return out;
  }
  function stripAcc(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function cleanReading(r) { return r.replace(/[.\-]/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function isKanji(c) { var p = c.codePointAt(0); return (p >= 0x4e00 && p <= 0x9fff) || (p >= 0x3400 && p <= 0x4dbf) || (p >= 0x20000 && p <= 0x2ffff) || (p >= 0xf900 && p <= 0xfaff); }

  /* ---------- storage ---------- */
  function emptyStore() { return { version: 1, history: [], favorites: {}, groups: [] }; }
  var store = loadStore();
  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.version === 1) {
        s.history = Array.isArray(s.history) ? s.history : [];
        s.favorites = s.favorites && typeof s.favorites === 'object' ? s.favorites : {};
        s.groups = Array.isArray(s.groups) ? s.groups : [];
        return s;
      }
    } catch (e) { /* ignore */ }
    return emptyStore();
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { alert('Could not save to this browser: ' + e.message); } }
  function addHistory(k) {
    store.history = store.history.filter(function (h) { return h.k !== k; });
    store.history.unshift({ k: k, t: Date.now() });
    if (store.history.length > HISTORY_CAP) store.history.length = HISTORY_CAP;
    save();
  }
  function isFav(k) { return !!store.favorites[k]; }
  function toggleFav(k) {
    if (isFav(k)) delete store.favorites[k]; else store.favorites[k] = { t: Date.now(), groups: [] };
    save(); refreshStars(); if (view === 'favorites') renderFavorites();
  }
  function setGroup(k, gid, on) {
    if (!store.favorites[k]) store.favorites[k] = { t: Date.now(), groups: [] };
    var g = store.favorites[k].groups.filter(function (x) { return x !== gid; });
    if (on) g.push(gid);
    store.favorites[k].groups = g; save(); refreshStars();
  }
  function newGroupId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- search ---------- */
  function buildIndex() {
    DATA.forEach(function (d, i) {
      d.rank = i;
      var ons = d.on.map(function (x) { return toHira(x); });
      var kuns = d.kun.map(cleanReading);
      d._kana = ons.concat(kuns);
      d._rom = d._kana.map(romaji);
      d._en = d.m.join(' ; ').toLowerCase();
      d._hv = d.hv.map(stripAcc);
      d._py = d.py.map(stripAcc);
      BY[d.k] = d;
    });
  }
  function search(q) {
    q = q.trim();
    if (!q) return DATA.slice(0, 80);
    var chars = Array.from(q).filter(isKanji);
    if (chars.length) {
      var seen = {}, out = [];
      chars.forEach(function (c) { if (BY[c] && !seen[c]) { seen[c] = 1; out.push(BY[c]); } });
      return out;
    }
    var kana = /^[\u3040-\u30ffー]+$/.test(q) ? toHira(q) : null;
    var lq = q.toLowerCase(), aq = stripAcc(q);
    var res = [];
    DATA.forEach(function (d) {
      var s = 0;
      if (kana) {
        d._kana.forEach(function (r) { if (r === kana) s = Math.max(s, 100); else if (r.indexOf(kana) === 0) s = Math.max(s, 60); });
      } else {
        d._rom.forEach(function (r) { if (r === aq) s = Math.max(s, 90); else if (aq.length > 1 && r.indexOf(aq) === 0) s = Math.max(s, 50); });
        d._hv.forEach(function (r) { if (r === aq) s = Math.max(s, 85); });
        d._py.forEach(function (r) { if (r === aq) s = Math.max(s, 80); });
        d.m.forEach(function (m) {
          var ml = m.toLowerCase();
          if (ml === lq) s = Math.max(s, 95);
          else if (new RegExp('\\b' + lq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(ml)) s = Math.max(s, 70);
          else if (lq.length > 2 && ml.indexOf(lq) >= 0) s = Math.max(s, 30);
        });
      }
      if (s) res.push([s, d]);
    });
    res.sort(function (a, b) { return b[0] - a[0] || a[1].rank - b[1].rank; });
    return res.slice(0, 150).map(function (x) { return x[1]; });
  }

  /* ---------- list rendering ---------- */
  function itemHTML(d, extra) {
    var r = d.on.slice(0, 2).concat(d.kun.map(cleanReading).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).slice(0, 2)).join('、');
    var hv = d.hv.length ? ' · ' + d.hv[0] : '';
    return '<li class="item' + (current === d.k ? ' sel' : '') + '" data-k="' + d.k + '">' +
      '<span class="k" lang="ja">' + d.k + '</span><span class="info"><div class="m">' + esc(d.m.slice(0, 3).join(', ')) + '</div>' +
      '<div class="r"><span lang="ja">' + esc(r) + '</span>' + esc(hv) + (d.py.length ? ' · ' + esc(d.py[0]) : '') + '</div></span>' +
      (extra || '') +
      '<button class="star' + (isFav(d.k) ? ' on' : '') + '" data-star="' + d.k + '" title="Favorite" aria-label="Favorite ' + d.k + '">★</button></li>';
  }
  function renderResults() {
    var q = $('#q').value, list = search(q);
    $('#count').textContent = q.trim() ? list.length + (list.length === 150 ? '+' : '') + ' match' + (list.length === 1 ? '' : 'es') : 'Most frequent Jōyō kanji (2,136 in total). Type to search.';
    $('#results').innerHTML = list.map(function (d) { return itemHTML(d); }).join('');
    if (q.trim() && list.length && !(current && list.some(function (d) { return d.k === current; }))) open(list[0].k, { delayHistory: true });
  }
  function dayLabel(t) {
    var d = new Date(t), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }
  function renderHistory() {
    var h = store.history.filter(function (x) { return BY[x.k]; }), html = '', last = '';
    if (!h.length) { $('#historyList').innerHTML = '<p class="muted small">Kanji you open are listed here, newest first.</p>'; $('#clearHistory').disabled = true; return; }
    $('#clearHistory').disabled = false;
    html = '';
    h.forEach(function (x) {
      var lab = dayLabel(x.t);
      if (lab !== last) { if (last) html += '</ul>'; html += '<div class="day">' + esc(lab) + '</div><ul class="list">'; last = lab; }
      var time = new Date(x.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      html += itemHTML(BY[x.k], '<span class="time">' + time + '</span><button class="x" data-unhist="' + x.k + '" title="Remove from history" aria-label="Remove from history">✕</button>');
    });
    $('#historyList').innerHTML = html + '</ul>';
  }
  function renderFavorites() {
    if (favGroup !== 'all' && !store.groups.some(function (g) { return g.id === favGroup; })) favGroup = 'all';
    var favKeys = Object.keys(store.favorites).filter(function (k) { return BY[k]; });
    var chips = '<button class="chip' + (favGroup === 'all' ? ' on' : '') + '" data-group="all">All (' + favKeys.length + ')</button>';
    store.groups.forEach(function (g) {
      var n = favKeys.filter(function (k) { return store.favorites[k].groups.indexOf(g.id) >= 0; }).length;
      chips += '<button class="chip' + (favGroup === g.id ? ' on' : '') + '" data-group="' + g.id + '">' + esc(g.name) + ' (' + n + ')</button>';
    });
    $('#groupChips').innerHTML = chips;
    $('#groupActions').innerHTML = favGroup === 'all' ? '' :
      '<button class="linkbtn" id="renameGroup">Rename group</button><span class="muted">·</span><button class="linkbtn danger" id="deleteGroup">Delete group</button>';
    var keys = favKeys.filter(function (k) { return favGroup === 'all' || store.favorites[k].groups.indexOf(favGroup) >= 0; });
    keys.sort(function (a, b) { return store.favorites[b].t - store.favorites[a].t; });
    $('#favList').innerHTML = keys.length ? keys.map(function (k) { return itemHTML(BY[k]); }).join('') :
      '<li class="muted small">' + (favGroup === 'all' ? 'Tap ★ on any kanji to save it here.' : 'No kanji in this group yet. Open a kanji and tick this group under its star.') + '</li>';
  }
  function refreshStars() {
    document.querySelectorAll('[data-star]').forEach(function (b) { b.classList.toggle('on', isFav(b.getAttribute('data-star'))); });
    if (current) renderGroupsBox();
  }
  function showView(v) {
    view = v;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === v); });
    ['search', 'history', 'favorites'].forEach(function (n) { $('#view-' + n).classList.toggle('hidden', n !== v); });
    if (v === 'history') renderHistory();
    if (v === 'favorites') renderFavorites();
  }

  /* ---------- strokes ---------- */
  function hexOf(k) { var h = k.codePointAt(0).toString(16); while (h.length < 5) h = '0' + h; return h; }
  function loadStrokes(k) {
    if (strokeCache[k]) return Promise.resolve(strokeCache[k]);
    return fetch('data/strokes/' + hexOf(k) + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (p) { if (Array.isArray(p)) p = { p: p, t: '' }; strokeCache[k] = p; return p; });
  }
  var STROKE_EN = {
    '㇀':'rising (tick up to the right)','㇁':'curved hook','㇂':'slanted hook','㇃':'bend-and-hook (lying hook)','㇄':'vertical then turn right',
    '㇅':'horizontal-turn-turn','㇆':'horizontal-turn-hook','㇇':'horizontal then left-falling','㇈':'horizontal-turn-bend-hook','㇉':'vertical-turn-bend-hook',
    '㇊':'horizontal-turn-rising','㇋':'horizontal-turn-turn-sweep','㇌':'horizontal-sweep-bend-hook','㇍':'horizontal-turn-bend','㇎':'horizontal-turn-turn-turn',
    '㇏':'right-falling sweep','㇐':'horizontal','㇑':'vertical','㇒':'left-falling sweep','㇓':'vertical then left sweep','㇔':'dot',
    '㇕':'horizontal then turn down','㇖':'horizontal hook','㇗':'vertical then turn right','㇘':'vertical-bend-turn','㇙':'vertical then rise right',
    '㇚':'vertical hook','㇛':'sweep then dot','㇜':'sweep then turn','㇝':'rising then right-falling','㇞':'vertical-turn-turn','㇟':'vertical-bend-hook',
    '㇠':'horizontal-slant-bend-hook','㇡':'horizontal-turn-turn-turn-hook','㇢':'sweep-hook','㇣':'circle'
  };
  function startPoint(d) { var m = /M\s*([-\d.]+)[ ,]*([-\d.]+)/i.exec(d); return m ? [+m[1], +m[2]] : [0, 0]; }
  function gridLines() { return '<path class="grid-line" d="M54.5 0V109M0 54.5H109"/>'; }
  function bigSVG(paths) {
    var s = '<svg viewBox="0 0 109 109" role="img" aria-label="Stroke order">' + gridLines();
    paths.forEach(function (d, i) { s += '<path class="stk" data-i="' + i + '" d="' + d + '"/>'; });
    var used = [];
    paths.forEach(function (d, i) {
      var p = startPoint(d), x = p[0] - 4, y = p[1] - 2;
      used.forEach(function (u) { if (Math.abs(u[0] - x) < 6 && Math.abs(u[1] - y) < 6) { y += 7; } });
      used.push([x, y]);
      s += '<text class="num" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="middle">' + (i + 1) + '</text>';
    });
    return s + '</svg>';
  }
  function frameSVG(paths, n) {
    var s = '<svg viewBox="0 0 109 109">' + gridLines();
    paths.forEach(function (d, i) { if (i <= n) s += '<path class="stk' + (i === n ? ' cur' : '') + '" d="' + d + '"/>'; else s += '<path class="stk ghost" d="' + d + '"/>'; });
    return s + '</svg>';
  }
  var animTimer = null;
  function animate() {
    var svg = document.querySelector('#bigsvg svg'); if (!svg) return;
    var ps = svg.querySelectorAll('.stk'); clearTimeout(animTimer);
    ps.forEach(function (p) { var L = p.getTotalLength(); p.style.transition = 'none'; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
    var i = 0;
    (function step() {
      if (i >= ps.length) return;
      var p = ps[i], L = p.getTotalLength(), dur = Math.max(250, L * 9);
      p.getBoundingClientRect();
      p.style.transition = 'stroke-dashoffset ' + dur + 'ms ease-in-out'; p.style.strokeDashoffset = 0;
      i++; animTimer = setTimeout(step, dur + 120);
    })();
  }

  /* ---------- detail ---------- */
  function rd(kana, isOn) {
    var disp = kana, rom;
    if (!isOn && kana.indexOf('.') >= 0) { var parts = kana.split('.'); disp = parts[0] + '<span class="ok">' + parts[1] + '</span>'; }
    rom = romaji(cleanReading(kana));
    return '<span class="rd"><span class="kana" lang="ja">' + disp.replace(/-/g, '‑') + '</span><span class="rom">' + esc(rom) + '</span></span>';
  }
  var OLDJLPT = { 4: 'JLPT old 4 (≈N5)', 3: 'JLPT old 3 (≈N4)', 2: 'JLPT old 2 (≈N3–N2)', 1: 'JLPT old 1 (≈N1)' };
  function renderGroupsBox() {
    var box = $('#groupsBox'); if (!box || !current) return;
    var f = store.favorites[current];
    var html = store.groups.map(function (g) {
      var on = f && f.groups.indexOf(g.id) >= 0;
      return '<label><input type="checkbox" data-setgroup="' + g.id + '"' + (on ? ' checked' : '') + '> ' + esc(g.name) + '</label>';
    }).join('');
    box.innerHTML = '<div class="muted" style="margin-bottom:2px">Save to group</div>' + (html || '<div class="muted">No groups yet.</div>') +
      '<button class="linkbtn" data-newgroup-for="' + current + '">+ New group</button>';
    var st = $('#detailStar'); if (st) st.classList.toggle('on', isFav(current));
  }
  function exampleHTML(e, k) {
    var w = Array.from(e[0]).map(function (c) { return c === k ? '<b>' + c + '</b>' : esc(c); }).join('');
    return '<div class="ex"><span class="w" lang="ja">' + w + '</span><span class="rr" lang="ja">' + esc(e[1]) + '<i>' + esc(romaji(e[1])) + '</i>' +
      (e[3] === 0 ? '<span class="tag">less common</span>' : '') + '</span><span class="g">' + esc(e[2]) + '</span></div>';
  }
  var histTimer = null;
  function open(k, opts) {
    opts = opts || {};
    var d = BY[k]; if (!d) return;
    current = k;
    clearTimeout(histTimer);
    if (opts.delayHistory) histTimer = setTimeout(function () { if (current === k) { addHistory(k); if (view === 'history') renderHistory(); } }, 2500);
    else if (!opts.noHistory) addHistory(k);
    if (location.hash !== '#' + encodeURIComponent(k)) history.replaceState(null, '', '#' + encodeURIComponent(k));
    document.title = k + ' · Kanji Lookup';
    var kokuji = d.m.indexOf('(kokuji)') >= 0;
    var meanings = d.m.filter(function (m) { return m !== '(kokuji)'; });
    var facts = ['<span class="fact">' + d.s + ' strokes</span>',
      '<span class="fact">Radical <span lang="ja">' + d.r[1] + '</span> (#' + d.r[0] + ')</span>',
      '<span class="fact">' + (d.g <= 6 ? 'Grade ' + d.g : 'Secondary school (Jōyō)') + '</span>'];
    if (d.j) facts.push('<span class="fact">' + OLDJLPT[d.j] + '</span>');
    if (d.f) facts.push('<span class="fact">Frequency #' + d.f + '</span>');
    if (kokuji) facts.push('<span class="fact">Kokuji (made in Japan)</span>');
    var comps = d.c.length ? d.c.map(function (c) { return '<span class="comp" lang="ja"' + (BY[c] ? ' data-k="' + c + '"' : '') + '>' + esc(c) + '</span>'; }).join('') : '<span class="muted">single component</span>';
    var html = '<div class="hero"><div class="big" lang="ja">' + k + '</div><div class="hero-main">' +
      '<div class="meanings">' + esc(meanings.join(', ')) + '</div><div class="facts">' + facts.join('') + '</div></div>' +
      '<div class="hero-actions"><button id="detailStar" class="star' + (isFav(k) ? ' on' : '') + '" data-star="' + k + '" title="Favorite" aria-label="Favorite">★</button><div id="groupsBox" class="groups-box"></div></div></div>';
    html += '<div class="sec"><h3>Readings compared</h3><table class="cmp">' +
      '<tr><th>On\'yomi 音読み<span>Chinese-derived, katakana</span></th><td>' + (d.on.length ? d.on.map(function (r) { return rd(r, true); }).join('') : '<span class="muted">none (native Japanese only)</span>') + '</td></tr>' +
      '<tr><th>Kun\'yomi 訓読み<span>native Japanese, hiragana</span></th><td>' + (d.kun.length ? d.kun.map(function (r) { return rd(r, false); }).join('') : '<span class="muted">none</span>') + '</td></tr>' +
      '<tr><th>Hanyu Pinyin<span>Mandarin</span></th><td>' + (d.py.length ? d.py.map(function (p) { return '<span class="rd"><span class="kana">' + esc(p) + '</span></span>'; }).join('') : '<span class="muted">' + (kokuji ? 'none (kokuji, no Chinese reading)' : 'not in source data') + '</span>') + '</td></tr>' +
      '<tr><th>Hán Việt<span>Sino-Vietnamese</span></th><td>' + (d.hv.length ? d.hv.map(function (p) { return '<span class="rd"><span class="kana">' + esc(p) + '</span></span>'; }).join('') : '<span class="muted">not in source data</span>') + '</td></tr>' +
      '</table>' +
      (d.vf ? '<p class="small muted">Pinyin/Hán Việt taken from the KANJIDIC2 entry of the variant form <span lang="ja">' + d.vf + '</span>.</p>' : '') +
      '<div class="hint">Tip: on\'yomi, pinyin and Hán Việt all descend from Middle Chinese, so they often sound alike (e.g. 学 gaku · xué · học; 国 koku · guó · quốc). Kun\'yomi is the native Japanese word and is unrelated.</div></div>';
    html += '<div class="sec"><h3>Stroke order</h3><div class="strokes-wrap"><div><div id="bigsvg" class="svgbox"></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="animBtn">▶ Animate</button><span class="small muted">Numbers mark where each stroke starts</span></div><p id="strokeNote" class="small muted"></p></div>' +
      '<div><div class="small" style="margin-bottom:6px">Components: ' + comps + '</div><div id="frames" class="frames"></div><div id="strokeNames"></div></div></div></div>';
    if (d.ex.length) html += '<div class="sec"><h3>Common words</h3>' + d.ex.map(function (e) { return exampleHTML(e, k); }).join('') + '</div>';
    $('#detail').innerHTML = html;
    renderGroupsBox();
    loadStrokes(k).then(function (sd) {
      if (current !== k) return;
      var paths = sd.p, types = Array.from(sd.t || '');
      if (paths.length !== d.s) $('#strokeNote').textContent = 'This diagram (KanjiVG glyph form) has ' + paths.length + ' strokes; KANJIDIC2 counts ' + d.s + ' for the Jōyō form.';
      $('#bigsvg').innerHTML = bigSVG(paths);
      $('#frames').innerHTML = paths.map(function (_, i) { return '<div class="frame">' + frameSVG(paths, i) + '<span class="fn">' + (i + 1) + '</span></div>'; }).join('');
      var names = paths.map(function (_, i) { var n = STROKE_EN[types[i]]; return n ? '<li>' + esc(n) + '</li>' : '<li class="muted">stroke ' + (i + 1) + '</li>'; }).join('');
      $('#strokeNames').innerHTML = '<div class="small" style="margin:10px 0 4px">Stroke by stroke (KanjiVG stroke types):</div><ol class="snames">' + names + '</ol>';
    }).catch(function () { if (current === k) $('#bigsvg').innerHTML = '<p class="muted small" style="padding:12px">Stroke data could not be loaded.</p>'; });
    document.querySelectorAll('.item').forEach(function (li) { li.classList.toggle('sel', li.getAttribute('data-k') === k); });
    if (view === 'history') renderHistory();
    if (!opts.keepScroll && window.innerWidth <= 820 && opts.scroll) $('#detail').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- groups ---------- */
  function createGroup(forKanji) {
    var name = (prompt('Name for the new group (e.g. "Lesson 3", "Food", "Lab words"):') || '').trim();
    if (!name) return;
    var g = { id: newGroupId(), name: name.slice(0, 60) };
    store.groups.push(g); save();
    if (forKanji) setGroup(forKanji, g.id, true);
    if (view === 'favorites') renderFavorites();
    renderGroupsBox();
  }

  /* ---------- export / import ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify({ app: 'kanji-lookup', exported: new Date().toISOString(), data: store }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'kanji-lookup-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    $('#backupMsg').textContent = 'Exported ' + store.history.length + ' history items and ' + Object.keys(store.favorites).length + ' favorites.';
  }
  function importData(text) {
    var obj = JSON.parse(text), inc = obj && obj.data ? obj.data : obj;
    if (!inc || !Array.isArray(inc.history) || typeof inc.favorites !== 'object') throw new Error('Not a Kanji Lookup backup file.');
    var replace = confirm('Replace your current data with this file?\n\nOK = replace, Cancel = merge (keep both).');
    if (replace) store = emptyStore();
    var hmap = {};
    store.history.concat(inc.history).forEach(function (h) { if (h && h.k && (!hmap[h.k] || hmap[h.k].t < h.t)) hmap[h.k] = { k: h.k, t: +h.t || Date.now() }; });
    store.history = Object.keys(hmap).map(function (k) { return hmap[k]; }).sort(function (a, b) { return b.t - a.t; }).slice(0, HISTORY_CAP);
    var gmap = {}; store.groups.forEach(function (g) { gmap[g.id] = g; });
    (inc.groups || []).forEach(function (g) { if (g && g.id && g.name) gmap[g.id] = { id: String(g.id), name: String(g.name).slice(0, 60) }; });
    store.groups = Object.keys(gmap).map(function (id) { return gmap[id]; });
    Object.keys(inc.favorites).forEach(function (k) {
      var f = inc.favorites[k] || {}, cur = store.favorites[k] || { t: +f.t || Date.now(), groups: [] };
      (f.groups || []).forEach(function (g) { if (gmap[g] && cur.groups.indexOf(g) < 0) cur.groups.push(g); });
      store.favorites[k] = cur;
    });
    save();
    $('#backupMsg').textContent = 'Imported. Now ' + store.history.length + ' history items, ' + Object.keys(store.favorites).length + ' favorites, ' + store.groups.length + ' groups.';
    showView(view); refreshStars();
  }

  /* ---------- theme ---------- */
  function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  applyTheme(localStorage.getItem(THEME_KEY));
  $('#themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var nt = cur === 'dark' ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, nt); applyTheme(nt);
  });

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var star = t.closest('[data-star]'); if (star) { e.stopPropagation(); toggleFav(star.getAttribute('data-star')); return; }
    var un = t.closest('[data-unhist]'); if (un) { e.stopPropagation(); var k = un.getAttribute('data-unhist'); store.history = store.history.filter(function (h) { return h.k !== k; }); save(); renderHistory(); return; }
    var ng = t.closest('[data-newgroup-for]'); if (ng) { createGroup(ng.getAttribute('data-newgroup-for')); return; }
    var chip = t.closest('[data-group]'); if (chip) { favGroup = chip.getAttribute('data-group'); renderFavorites(); return; }
    var tab = t.closest('.tab'); if (tab) { showView(tab.getAttribute('data-view')); return; }
    var it = t.closest('[data-k]'); if (it && !t.closest('input')) { open(it.getAttribute('data-k'), { scroll: true }); return; }
    if (t.id === 'animBtn') animate();
    if (t.id === 'newGroup') createGroup(null);
    if (t.id === 'renameGroup') {
      var g = store.groups.filter(function (x) { return x.id === favGroup; })[0];
      var nm = g && (prompt('Rename group:', g.name) || '').trim();
      if (nm) { g.name = nm.slice(0, 60); save(); renderFavorites(); renderGroupsBox(); }
    }
    if (t.id === 'deleteGroup') {
      var g2 = store.groups.filter(function (x) { return x.id === favGroup; })[0];
      if (g2 && confirm('Delete the group "' + g2.name + '"? The kanji stay in your favorites.')) {
        store.groups = store.groups.filter(function (x) { return x.id !== g2.id; });
        Object.keys(store.favorites).forEach(function (k) { store.favorites[k].groups = store.favorites[k].groups.filter(function (x) { return x !== g2.id; }); });
        favGroup = 'all'; save(); renderFavorites(); renderGroupsBox();
      }
    }
    if (t.id === 'clearHistory') {
      if (store.history.length && confirm('Clear all ' + store.history.length + ' history items? This cannot be undone (export a backup first if unsure).')) { store.history = []; save(); renderHistory(); }
    }
    if (t.id === 'exportBtn') exportData();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-setgroup]')) { setGroup(current, t.getAttribute('data-setgroup'), t.checked); if (view === 'favorites') renderFavorites(); }
    if (t.id === 'importFile' && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { try { importData(fr.result); } catch (err) { $('#backupMsg').textContent = 'Import failed: ' + err.message; } t.value = ''; };
      fr.readAsText(t.files[0]);
    }
  });
  var deb; $('#q').addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(renderResults, 120); });
  $('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = document.querySelector('#results .item'); if (f) open(f.getAttribute('data-k'), { scroll: true }); } });
  window.addEventListener('hashchange', function () { var k = decodeURIComponent(location.hash.slice(1)); if (BY[k] && k !== current) open(k); });
  window.addEventListener('storage', function (e) { if (e.key === STORE_KEY) { store = loadStore(); showView(view); refreshStars(); } });

  /* ---------- boot ---------- */
  fetch('data/kanji.json').then(function (r) { return r.json(); }).then(function (data) {
    DATA = data; buildIndex();
    renderResults();
    var h = decodeURIComponent(location.hash.slice(1));
    if (BY[h]) open(h); else open('学', { noHistory: true });
  }).catch(function (e) { $('#detail').innerHTML = '<p>Could not load data/kanji.json (' + esc(e.message) + '). If you opened the file directly, serve the folder over http (e.g. GitHub Pages or <code>python3 -m http.server</code>).</p>'; });

  window.KanjiLookup = { romaji: romaji, search: function (q) { return search(q).map(function (d) { return d.k; }); }, store: function () { return store; } };
})();
