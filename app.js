/* Kanji Lookup — vanilla JS, no build step. Data: KANJIDIC2, JMdict (EDRDG, CC BY-SA 4.0), KanjiVG (CC BY-SA 3.0). */
(function () {
  'use strict';
  var STORE_KEY = 'kanjiLookup.v1';
  var ASK_KEY = 'kanjiLookup.ask.v1';
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

  /* ---------- speech (Web Speech API; hidden when unsupported) ---------- */
  var SPEECH = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  var jaVoice = null, enVoice = null, speakBtnEl = null, speakGen = 0;
  function pickVoices() {
    if (!SPEECH) return;
    var vs = speechSynthesis.getVoices() || [], i, lang;
    jaVoice = null; enVoice = null;
    for (i = 0; i < vs.length; i++) {
      lang = (vs[i].lang || '').toLowerCase();
      if (lang.indexOf('ja') === 0 && (!jaVoice || (lang.indexOf('ja-jp') === 0 && (jaVoice.lang || '').toLowerCase().indexOf('ja-jp') !== 0))) jaVoice = vs[i];
      if (lang.indexOf('en') === 0 && !enVoice) enVoice = vs[i];
    }
  }
  if (SPEECH) { pickVoices(); speechSynthesis.addEventListener('voiceschanged', pickVoices); }
  function speakBtn(lang, text, label) {
    if (!SPEECH || !text) return '';
    return '<button type="button" class="speak" data-speak="' + lang + '" data-text="' + esc(text) + '" data-label="' + esc(label) + '" aria-label="' + esc(label) + '">▶</button>';
  }
  function clearSpeak() {
    if (!speakBtnEl) return;
    speakBtnEl.classList.remove('speaking');
    speakBtnEl.textContent = '▶';
    speakBtnEl.setAttribute('aria-label', speakBtnEl.getAttribute('data-label') || 'Play');
    speakBtnEl = null;
  }
  function toggleSpeak(btn) {
    if (!SPEECH) return;
    if (speakBtnEl === btn) { speakGen++; speechSynthesis.cancel(); clearSpeak(); return; }
    var gen = ++speakGen;
    speechSynthesis.cancel();
    clearSpeak();
    speakBtnEl = btn;
    btn.classList.add('speaking');
    btn.textContent = '■';
    btn.setAttribute('aria-label', 'Stop');
    var u = new SpeechSynthesisUtterance(btn.getAttribute('data-text') || '');
    var lang = btn.getAttribute('data-speak') === 'en' ? 'en-US' : 'ja-JP';
    u.lang = lang;
    var voice = lang === 'ja-JP' ? jaVoice : enVoice;
    if (voice) u.voice = voice;
    u.onend = u.onerror = function () { if (gen === speakGen) clearSpeak(); };
    speechSynthesis.speak(u);
  }

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

  /* ---------- ask (dictionary only, no network) ---------- */
  var FILL = {};
  'a an the to of for and or in on at by with from as is are was were be been being what who which that this these those there it its me my i you your we they them do does did can could would should please tell show find give list want about into over up out off again away down upon than then so if not no yes just some any every thing things something kanji character characters japanese joyo word words meaning meanings mean means meant definition define explain called name named how why when where look lookup'.split(/\s+/).forEach(function (w) { FILL[w] = 1; });
  var IRREG = { thought: 'think', thoughts: 'think', thinking: 'think', thinks: 'think', decided: 'decide', deciding: 'decide', decision: 'decide', decisions: 'decide' };
  var RAD = { water: '水氵', ice: '冫', fire: '火灬', tree: '木', wood: '木', person: '人亻', people: '人亻', human: '人亻', man: '人亻', hand: '手扌', heart: '心忄', mind: '心忄', feeling: '心忄', speech: '言', language: '言', talk: '言', say: '言', word: '言', metal: '金', gold: '金', mouth: '口', earth: '土', soil: '土', ground: '土', grass: '艹艸', plant: '艹艸', sun: '日', day: '日', moon: '月', month: '月', woman: '女', thread: '糸', silk: '糸', knife: '刀刂', sword: '刀刂', mountain: '山', stone: '石', rock: '石', rain: '雨', fish: '魚', bird: '鳥', horse: '馬', dog: '犬犭', eye: '目', ear: '耳', foot: '足', car: '車', vehicle: '車', food: '食', eat: '食', rice: '米', gate: '門', door: '門', cloth: '巾', clothes: '衣衤', wind: '風', insect: '虫', bug: '虫', money: '貝', shell: '貝', bamboo: '竹', field: '田', power: '力', strength: '力', king: '王', jewel: '玉', road: '辵⻌', walk: '辵⻌', hill: '阜阝⻖', sick: '疒', illness: '疒', disease: '疒', alcohol: '酉', wine: '酉', sake: '酉', boat: '舟', ship: '舟', cow: '牛', ox: '牛', child: '子', spirit: '示礻', death: '歹', sound: '音', body: '肉', meat: '肉', see: '見目', run: '走' };
  var RAD_CH = {};
  Object.keys(RAD).forEach(function (k) { Array.from(RAD[k]).forEach(function (ch) { RAD_CH[ch] = RAD[k]; }); });
  var ASK_HINTS = ['fancy word for think', 'kanji meaning to decide', 'kanji related to water', 'kanji with the reading sui', 'what does 語 mean'];
  function stemSet(w) {
    var s = {}; s[w] = 1;
    if (IRREG[w]) s[IRREG[w]] = 1;
    var b;
    if (w.length > 4 && /ing$/.test(w)) { b = w.slice(0, -3); s[b] = 1; s[b + 'e'] = 1; if (b.length > 2 && b.slice(-1) === b.slice(-2, -1)) s[b.slice(0, -1)] = 1; }
    if (w.length > 4 && /ied$/.test(w)) s[w.slice(0, -3) + 'y'] = 1;
    else if (w.length > 3 && /ed$/.test(w)) { b = w.slice(0, -2); s[b] = 1; s[b + 'e'] = 1; if (b.length > 2 && b.slice(-1) === b.slice(-2, -1)) s[b.slice(0, -1)] = 1; }
    if (w.length > 4 && /ies$/.test(w)) s[w.slice(0, -3) + 'y'] = 1;
    else if (w.length > 3 && /es$/.test(w)) { s[w.slice(0, -2)] = 1; s[w.slice(0, -1)] = 1; }
    else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) s[w.slice(0, -1)] = 1;
    return s;
  }
  function hitsWord(w, stems) { var s = stemSet(w), k; for (k in s) if (stems[k]) return true; return false; }
  function stemsOf(text) {
    var stems = {}, words = (String(text).toLowerCase().match(/[a-z']+/g) || []);
    words.forEach(function (w) {
      if (FILL[w] || w.length < 3) return;
      var s = stemSet(w), k; for (k in s) if (k.length > 2) stems[k] = 1;
    });
    return stems;
  }
  function fr(d) { return d.f || 99999; }
  function meaningScore(d, stems) {
    var best = 0, i, words, sc;
    for (i = 0; i < d.m.length; i++) {
      if (!d.m[i] || d.m[i].charAt(0) === '(') continue;
      words = (d.m[i].toLowerCase().match(/[a-z']+/g) || []).filter(function (w) { return !FILL[w] && w.length > 1; });
      if (!words.length || !words.some(function (w) { return hitsWord(w, stems); })) continue;
      if (words.length === 1) sc = 100;
      else if (hitsWord(words[0], stems) && words.length <= 3) sc = 92;
      else if (hitsWord(words[0], stems)) sc = 76;
      else sc = 46;
      sc -= Math.min(12, i * 4);
      if (sc > best) best = sc;
    }
    return best;
  }
  function glossScore(gloss, stems) {
    var best = 0, senses = String(gloss).split(';'), i, words, sc;
    for (i = 0; i < senses.length && i < 3; i++) {
      words = (senses[i].replace(/\([^)]*\)/g, ' ').toLowerCase().match(/[a-z']+/g) || []).filter(function (w) { return !FILL[w] && w.length > 1; });
      if (!words.length || !words.some(function (w) { return hitsWord(w, stems); })) continue;
      if (words.length === 1) sc = 100;
      else if (hitsWord(words[0], stems) && words.length <= 3) sc = 90;
      else if (hitsWord(words[0], stems)) sc = 70;
      else sc = 26;
      if (words.length > 6) sc = Math.min(sc, 26);
      sc -= i * 4;
      if (sc > best) best = sc;
    }
    return best;
  }
  function readingScore(d, q) {
    var s = 0, aq = stripAcc(String(q).toLowerCase()), kana = /^[\u3040-\u30ffー]+$/.test(q) ? toHira(q) : null;
    if (kana) d._kana.forEach(function (r) { if (r === kana) s = 100; });
    else {
      d._rom.forEach(function (r) { if (r === aq) s = 100; });
      d._py.forEach(function (r) { if (r === aq) s = 100; });
      d._hv.forEach(function (r) { if (r === aq) s = 100; });
    }
    return s;
  }
  function topKanji(list, n) {
    list.sort(function (a, b) { return b[0] - a[0] || fr(a[1]) - fr(b[1]) || a[1].rank - b[1].rank; });
    var out = [], seen = {}, i;
    for (i = 0; i < list.length && out.length < n; i++) { if (!seen[list[i][1].k]) { seen[list[i][1].k] = 1; out.push(list[i][1]); } }
    return out;
  }
  function hasForm(d, forms) {
    if (!forms) return false;
    if (forms.indexOf(d.k) >= 0 || forms.indexOf(d.r[1]) >= 0) return true;
    for (var i = 0; i < d.c.length; i++) if (forms.indexOf(d.c[i]) >= 0) return true;
    return false;
  }
  function formsFor(concept) {
    var forms = '';
    (String(concept).toLowerCase().match(/[a-z']+/g) || []).forEach(function (w) { if (RAD[w]) forms += RAD[w]; });
    Array.from(concept).forEach(function (c) { if (RAD_CH[c]) forms += RAD_CH[c]; else if (isKanji(c)) forms += c; });
    return forms;
  }
  function exampleHits(stems, limit, rareFirst) {
    var seen = {}, rows = [];
    DATA.forEach(function (d) {
      d.ex.forEach(function (e) {
        if (seen[e[0]]) return;
        var gs = glossScore(e[2], stems);
        if (gs < 78) return;
        var ks = Array.from(e[0]).filter(function (c) { return BY[c]; });
        if (!ks.length) return;
        seen[e[0]] = 1;
        var rare = 0, common = 99999;
        ks.forEach(function (k) { var f = fr(BY[k]); if (f > rare) rare = f; if (f < common) common = f; });
        var bestK = ks.slice().sort(function (a, b) { return meaningScore(BY[b], stems) - meaningScore(BY[a], stems) || fr(BY[b]) - fr(BY[a]); })[0];
        rows.push({ w: e[0], y: e[1], g: e[2], k: bestK, gs: gs, rare: rare, common: common, L: ks.length });
      });
    });
    if (rareFirst) rows.sort(function (a, b) { return (b.L >= 2) - (a.L >= 2) || b.rare - a.rare || b.L - a.L || b.gs - a.gs; });
    else rows.sort(function (a, b) { return b.gs - a.gs || a.common - b.common || b.L - a.L; });
    return rows.slice(0, limit);
  }
  function fancyWords(stems) {
    var seen = {}, rows = [];
    DATA.forEach(function (d) {
      d.ex.forEach(function (e) {
        if (seen[e[0]]) return;
        var ks = Array.from(e[0]).filter(function (c) { return BY[c]; });
        if (ks.length < 2) return;
        var gs = glossScore(e[2], stems);
        var allm = ks.every(function (k) { return meaningScore(BY[k], stems) >= 70; });
        if (!(gs >= 78 || allm)) return;
        seen[e[0]] = 1;
        var rare = 0;
        ks.forEach(function (k) { var f = fr(BY[k]); if (f > rare) rare = f; });
        var bestK = ks.slice().sort(function (a, b) { return meaningScore(BY[b], stems) - meaningScore(BY[a], stems) || fr(BY[b]) - fr(BY[a]); })[0];
        rows.push({ w: e[0], y: e[1], g: e[2], k: bestK, gs: gs, rare: rare, L: ks.length });
      });
    });
    rows.sort(function (a, b) { return b.rare - a.rare || b.L - a.L || b.gs - a.gs; });
    var top = rows.slice(0, 4);
    rows.slice().sort(function (a, b) { return b.gs - a.gs; }).forEach(function (w) {
      if (top.length < 6 && w.gs >= 90 && !top.some(function (t) { return t.w === w.w; })) top.push(w);
    });
    top.sort(function (a, b) { return b.rare - a.rare || b.L - a.L || b.gs - a.gs; });
    return top.slice(0, 6);
  }
  function askIntent(raw) {
    var s = raw.toLowerCase();
    var kanji = Array.from(raw).filter(function (c) { return isKanji(c) && BY[c]; });
    if (/\b(fancy|formal|literary|polite|sophisticated)\b/.test(s)) return 'fancy';
    if (/\brelated to\b|\bassociated with\b|\bto do with\b|\bconnected to\b/.test(s)) return 'related';
    if (!kanji.length && /\b(readings?|pronounced|pronunciation|onyomi|kunyomi|romaji|pinyin|han viet|hanviet)\b/.test(s)) return 'reading';
    var latin = (s.match(/[a-z']+/g) || []).filter(function (w) { return !FILL[w] && w.length > 2; });
    if (kanji.length && !latin.length) return 'explain';
    return 'meaning';
  }
  function conceptText(raw, intent) {
    var s = raw.toLowerCase().replace(/[?.!。？！]+$/g, '').trim(), m;
    if (intent === 'fancy') { m = /\b(?:for|of|saying|to say)\s+(.+)$/.exec(s); if (m) s = m[1]; }
    else if (intent === 'related') { m = /\b(?:related to|associated with|to do with|connected to)\s+(.+)$/.exec(s); if (m) s = m[1]; }
    else if (intent === 'reading') { m = /\b(?:readings?|pronounced|pronunciation|onyomi|kunyomi|romaji|pinyin|han viet|hanviet)\b\s*(?:of|for|is|:)?\s*(.+)$/.exec(s); if (m) s = m[1]; }
    var parts = s.split(/\s+/).filter(Boolean);
    var skip = /^(fancy|formal|literary|polite|sophisticated|related|reading|pronounced|pinyin|romaji|onyomi|kunyomi)$/;
    while (parts.length && (FILL[parts[0]] || skip.test(parts[0]))) parts.shift();
    while (parts.length && (FILL[parts[parts.length - 1]] || skip.test(parts[parts.length - 1]))) parts.pop();
    return parts.join(' ').trim();
  }
  function stemsFromConcept(concept) {
    var stems = stemsOf(concept);
    var ks = Array.from(concept).filter(function (c) { return BY[c]; });
    if (ks.length && !/[a-z]/i.test(concept)) ks.forEach(function (k) { BY[k].m.slice(0, 4).forEach(function (m) { var e = stemsOf(m); for (var x in e) stems[x] = 1; }); });
    return stems;
  }
  function noMatch(intent) {
    return { intent: intent, lead: 'I could not match that to a Jōyō kanji. Try a meaning, a reading, something it is related to, or paste a kanji.', kanji: [], words: [], hints: ASK_HINTS };
  }
  function ask(raw) {
    raw = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { intent: 'empty', lead: 'Ask in ordinary words. A few things that work:', kanji: [], words: [], hints: ASK_HINTS };
    var intent = askIntent(raw), concept = conceptText(raw, intent) || raw, stems = stemsFromConcept(concept);
    if (intent === 'explain') {
      var seen = {}, ks = [];
      Array.from(raw).forEach(function (c) { if (BY[c] && !seen[c]) { seen[c] = 1; ks.push(BY[c]); } });
      ks = ks.slice(0, 8);
      var lead = ks.map(function (d) { return d.k + ' — ' + d.m.filter(function (m) { return m !== '(kokuji)'; }).slice(0, 4).join(', '); }).join(' · ');
      return { intent: 'explain', lead: lead || 'Those characters are not in the Jōyō list.', kanji: ks, words: [], hints: ks.length ? [] : ASK_HINTS };
    }
    if (intent === 'reading' || (!Object.keys(stems).length && !Array.from(concept).some(isKanji))) {
      var q = concept, rows = [];
      DATA.forEach(function (d) { var sc = readingScore(d, q); if (sc) rows.push([sc, d]); });
      var found = topKanji(rows, 8);
      if (found.length) return { intent: 'reading', lead: 'Kanji with the reading “' + q + '”.', kanji: found, words: [], hints: [] };
      if (intent === 'reading') return { intent: 'reading', lead: 'No Jōyō reading matched “' + q + '”.', kanji: [], words: [], hints: ASK_HINTS };
    }
    if (intent === 'fancy') {
      var fw = fancyWords(stems), cards = [], seenK = {};
      fw.forEach(function (w) { Array.from(w.w).forEach(function (c) { if (BY[c] && !seenK[c] && cards.length < 8) { seenK[c] = 1; cards.push(BY[c]); } }); });
      if (fw.length || cards.length) return { intent: 'fancy', lead: 'More formal or literary words for “' + concept + '”, rarer and longer compounds first.', kanji: cards, words: fw, hints: [] };
    }
    if (intent === 'related') {
      var forms = formsFor(concept), rel = [];
      DATA.forEach(function (d) {
        var ms = meaningScore(d, stems), rad = hasForm(d, forms), sc = ms;
        if (rad) sc = Math.max(sc, 42) + (ms >= 70 ? 24 : 0);
        if (sc >= 42) rel.push([sc, d]);
      });
      var relK = topKanji(rel, 8);
      if (relK.length) {
        var uniq = Array.from(forms).filter(function (c, i, a) { return a.indexOf(c) === i; }).join('·');
        return { intent: 'related', lead: 'Kanji related to “' + concept + '”' + (uniq ? ' (radical ' + uniq + ')' : '') + '.', kanji: relK, words: exampleHits(stems, 4, false), hints: [] };
      }
    }
    var mr = [];
    DATA.forEach(function (d) { var sc = meaningScore(d, stems); if (sc >= 70) mr.push([sc, d]); });
    var mk = topKanji(mr, 8);
    if (mk.length) return { intent: 'meaning', lead: 'Kanji meaning “' + concept + '”.', kanji: mk, words: exampleHits(stems, 4, false), hints: [] };
    return noMatch(intent);
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
    ['search', 'history', 'favorites', 'ask'].forEach(function (n) { $('#view-' + n).classList.toggle('hidden', n !== v); });
    if (v === 'history') renderHistory();
    if (v === 'favorites') renderFavorites();
    if (v === 'ask') renderAsk();
  }

  /* ---------- strokes ---------- */
  function hexOf(k) { var h = k.codePointAt(0).toString(16); while (h.length < 5) h = '0' + h; return h; }
  var exCache = {};
  function loadExamples(k) {
    if (exCache[k]) return Promise.resolve(exCache[k]);
    return fetch('data/ex/' + hexOf(k) + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { exCache[k] = j || []; return exCache[k]; })
      .catch(function () { exCache[k] = []; return []; });
  }
  function stepBack(s, i) { var p = i - 1; if (p > 0 && s.charCodeAt(p) >= 0xDC00 && s.charCodeAt(p) <= 0xDFFF) p--; return p; }
  function annotatedHTML(s) {
    var out = '', i = 0, j, k, w;
    while (i < s.length) {
      j = s.indexOf('[', i);
      if (j < 0) { out += esc(s.slice(i)); break; }
      k = s.indexOf(']', j); if (k < 0) { out += esc(s.slice(i)); break; }
      w = j; while (w > i && isKanji(s.slice(stepBack(s, w)))) w = stepBack(s, w);
      out += esc(s.slice(i, w)) + '<ruby>' + esc(s.slice(w, j)) + '<rt>' + esc(s.slice(j + 1, k)) + '</rt></ruby>';
      i = k + 1;
    }
    return out;
  }
  function annotatedKana(s) {
    var out = '', i = 0, j, k, w;
    while (i < s.length) {
      j = s.indexOf('[', i);
      if (j < 0) { out += s.slice(i); break; }
      k = s.indexOf(']', j); if (k < 0) { out += s.slice(i); break; }
      w = j; while (w > i && isKanji(s.slice(stepBack(s, w)))) w = stepBack(s, w);
      out += s.slice(i, w) + s.slice(j + 1, k);
      i = k + 1;
    }
    return out;
  }
  function sentenceHTML(row) {
    var kana = annotatedKana(row[0]);
    return '<div class="sent"><p class="sent-jp" lang="ja">' + annotatedHTML(row[0]) + speakBtn('ja', kana, 'Play sentence') +
      (row[2] === 'g' ? ' <span class="tag">generated</span>' : '') + '</p><p class="sent-en">' + esc(row[1]) + '</p></div>';
  }
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
    var say = cleanReading(kana);
    return '<span class="rd"><span class="kana" lang="ja">' + disp.replace(/-/g, '‑') + '</span><span class="rom">' + esc(rom) + '</span>' + speakBtn('ja', say, 'Play ' + say) + '</span>';
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
    html += '<div class="sec" id="exBox"><h3>Example sentences</h3><p class="muted small">Loading…</p></div>';
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
      if (opts.animate) animate();
    }).catch(function () { if (current === k) $('#bigsvg').innerHTML = '<p class="muted small" style="padding:12px">Stroke data could not be loaded.</p>'; });
    loadExamples(k).then(function (rows) {
      if (current !== k) return;
      var box = $('#exBox'); if (!box) return;
      if (!rows.length) { box.remove(); return; }
      box.innerHTML = '<h3>Example sentences</h3>' + rows.slice(0, 2).map(sentenceHTML).join('') +
        '<p class="small muted">Tanaka corpus (Tatoeba), CC BY 2.0 FR. “generated” lines are drafts.</p>';
    });
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
    var spk = t.closest('.speak'); if (spk) { e.stopPropagation(); e.preventDefault(); toggleSpeak(spk); return; }
    var hint = t.closest('[data-ask]'); if (hint) { submitAsk(hint.getAttribute('data-ask')); return; }
    var star = t.closest('[data-star]'); if (star) { e.stopPropagation(); toggleFav(star.getAttribute('data-star')); return; }
    var un = t.closest('[data-unhist]'); if (un) { e.stopPropagation(); var k = un.getAttribute('data-unhist'); store.history = store.history.filter(function (h) { return h.k !== k; }); save(); renderHistory(); return; }
    var ng = t.closest('[data-newgroup-for]'); if (ng) { createGroup(ng.getAttribute('data-newgroup-for')); return; }
    var chip = t.closest('[data-group]'); if (chip) { favGroup = chip.getAttribute('data-group'); renderFavorites(); return; }
    var tab = t.closest('.tab'); if (tab) { showView(tab.getAttribute('data-view')); return; }
    var it = t.closest('[data-k]'); if (it && !t.closest('input')) { open(it.getAttribute('data-k'), { scroll: true, animate: !!it.closest('#askThread') }); return; }
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
    if (t.id === 'clearAsk') { askLog = []; saveAsk(); renderAsk(); }
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

  /* ---------- ask thread ---------- */
  function loadAsk() { try { var a = JSON.parse(localStorage.getItem(ASK_KEY)); if (Array.isArray(a)) return a.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(-40); } catch (e2) { /* ignore */ } return []; }
  var askLog = loadAsk(), askGen = 0;
  function saveAsk() { try { localStorage.setItem(ASK_KEY, JSON.stringify(askLog)); } catch (e2) { /* ignore */ } }
  function readingBits(d) {
    function one(r) {
      var say = cleanReading(r), disp = r;
      if (r.indexOf('.') >= 0) { var p = r.split('.'); disp = esc(p[0]) + '<span class="ok">' + esc(p[1]) + '</span>'; }
      else disp = esc(r).replace(/-/g, '‑');
      return '<span class="rd"><span class="kana" lang="ja">' + disp + '</span>' + speakBtn('ja', say, 'Play ' + say) + '</span>';
    }
    return d.on.map(one).join('') + d.kun.map(one).join('');
  }
  function renderAsk() {
    var thread = $('#askThread'); if (!thread) return;
    var gen = ++askGen;
    if (!askLog.length) {
      thread.innerHTML = '<div class="bubble bot"><p>Ask in ordinary words. A few things that work:</p><div class="hints">' +
        ASK_HINTS.map(function (h) { return '<button type="button" class="hint-btn" data-ask="' + esc(h) + '">' + esc(h) + '</button>'; }).join('') + '</div></div>';
      return;
    }
    thread.innerHTML = askLog.map(function (q) {
      var a = ask(q);
      var words = a.words.length ? '<div class="ask-words">' + a.words.map(function (w) {
        return '<button type="button" class="ask-word" data-k="' + w.k + '"><span class="w" lang="ja">' + esc(w.w) + '</span><span class="rom">' + esc(romaji(w.y)) + '</span><span class="g">' + esc(w.g) + '</span></button>';
      }).join('') + '</div>' : '';
      var cards = a.kanji.map(function (d) {
        var ms = d.m.filter(function (m) { return m !== '(kokuji)'; }).slice(0, 3).join(', ');
        var meta = [d.py[0] || '', d.hv[0] || ''].filter(Boolean).join(' · ');
        return '<div class="ask-card" data-k="' + d.k + '"><span class="k" lang="ja">' + d.k + '</span><span class="info"><div class="m">' + esc(ms) + '</div><div class="r">' + readingBits(d) + '</div>' +
          (meta ? '<div class="r">' + esc(meta) + '</div>' : '') + '<div class="ask-ex" data-ex="' + d.k + '"></div></span></div>';
      }).join('');
      var hints = a.hints && a.hints.length ? '<div class="hints">' + a.hints.map(function (h) { return '<button type="button" class="hint-btn" data-ask="' + esc(h) + '">' + esc(h) + '</button>'; }).join('') + '</div>' : '';
      return '<div class="bubble user">' + esc(q) + '</div><div class="bubble bot"><p>' + esc(a.lead) + '</p>' + words + cards + hints + '</div>';
    }).join('');
    thread.querySelectorAll('[data-ex]').forEach(function (el) {
      loadExamples(el.getAttribute('data-ex')).then(function (rows) {
        if (gen !== askGen) return;
        el.innerHTML = (rows || []).slice(0, 2).map(sentenceHTML).join('');
      });
    });
    var lastUser = thread.querySelector('.bubble.user:last-of-type');
    if (lastUser) {
      var top = lastUser.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
      thread.scrollTop = Math.max(0, top - 4);
    }
  }
  function submitAsk(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    askLog.push(text.slice(0, 200));
    if (askLog.length > 40) askLog = askLog.slice(-40);
    saveAsk();
    if ($('#askQ')) $('#askQ').value = '';
    showView('ask');
  }
  var askForm = $('#askForm');
  if (askForm) askForm.addEventListener('submit', function (e) { e.preventDefault(); submitAsk($('#askQ').value); });

  window.KanjiLookup = {
    romaji: romaji,
    search: function (q) { return search(q).map(function (d) { return d.k; }); },
    store: function () { return store; },
    ask: function (q) { var a = ask(q); return { intent: a.intent, lead: a.lead, kanji: a.kanji.map(function (d) { return d.k; }), words: a.words.map(function (w) { return { w: w.w, k: w.k, g: w.g }; }) }; },
    speech: function () { return SPEECH; }
  };
})();
