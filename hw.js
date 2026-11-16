/* Handwriting pad. Stroke shapes in data/hw.bin are derived from KanjiVG (CC BY-SA 3.0).
   Matching is stroke-order free and allows a few extra or missing strokes, following the
   approach of KanjiCanvas by Dominik Klein (MIT): https://github.com/asdfjkl/kanjicanvas
   Nothing here submits a search. The page does that only on Enter or the Search button. */
(function (window, document) {
  'use strict';
  var N = 8, PEN = 130, LIMIT = 3, TOP = 10;
  var chars = [], model = null, strokes = [], drawing = null, activeId = null;

  function resample(pts) {
    if (!pts.length) return [];
    if (pts.length === 1) {
      var one = [];
      for (var k = 0; k < N; k++) one.push([pts[0].x, pts[0].y]);
      return one;
    }
    var seg = [], total = 0, i, dx, dy, L;
    for (i = 1; i < pts.length; i++) {
      dx = pts[i].x - pts[i - 1].x; dy = pts[i].y - pts[i - 1].y;
      L = Math.sqrt(dx * dx + dy * dy);
      seg.push(L); total += L;
    }
    if (total < 1e-6) {
      var flat = [];
      for (k = 0; k < N; k++) flat.push([pts[0].x, pts[0].y]);
      return flat;
    }
    var out = [];
    for (var k = 0; k < N; k++) {
      var target = total * k / (N - 1), acc = 0, placed = false;
      for (i = 0; i < seg.length; i++) {
        L = seg[i];
        if (acc + L >= target - 1e-9) {
          var t = L < 1e-9 ? 0 : (target - acc) / L;
          out.push([
            pts[i].x + (pts[i + 1].x - pts[i].x) * t,
            pts[i].y + (pts[i + 1].y - pts[i].y) * t
          ]);
          placed = true;
          break;
        }
        acc += L;
      }
      if (!placed) out.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
    }
    return out;
  }

  function normalize(raw) {
    var xs = [], ys = [], s, i, p;
    for (s = 0; s < raw.length; s++) for (i = 0; i < raw[s].length; i++) {
      p = raw[s][i];
      xs.push(p.x !== undefined ? p.x : p[0]);
      ys.push(p.y !== undefined ? p.y : p[1]);
    }
    if (!xs.length) return [];
    var minx = xs[0], maxx = xs[0], miny = ys[0], maxy = ys[0], n;
    for (n = 1; n < xs.length; n++) {
      if (xs[n] < minx) minx = xs[n];
      if (xs[n] > maxx) maxx = xs[n];
      if (ys[n] < miny) miny = ys[n];
      if (ys[n] > maxy) maxy = ys[n];
    }
    var span = Math.max(maxx - minx, maxy - miny, 1e-6);
    var scale = 255 / span;
    var ox = (255 - (maxx - minx) * scale) / 2 - minx * scale;
    var oy = (255 - (maxy - miny) * scale) / 2 - miny * scale;
    var out = [];
    for (s = 0; s < raw.length; s++) {
      var pts = [];
      for (i = 0; i < raw[s].length; i++) {
        p = raw[s][i];
        pts.push({ x: p.x !== undefined ? p.x : p[0], y: p.y !== undefined ? p.y : p[1] });
      }
      var rs = resample(pts), st = [];
      for (i = 0; i < rs.length; i++) st.push([rs[i][0] * scale + ox, rs[i][1] * scale + oy]);
      out.push(st);
    }
    return out;
  }

  function l1(a, b) {
    var d = 0, i;
    for (i = 0; i < N; i++) d += Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]);
    return d / N;
  }
  function strokeDist(a, b) {
    var rev = [], i;
    for (i = N - 1; i >= 0; i--) rev.push(b[i]);
    var f = l1(a, b), r = l1(a, rev);
    return f < r ? f : r;
  }
  function modelStroke(off) {
    var st = [], i, o;
    for (i = 0; i < N; i++) {
      o = off + i * 2;
      st.push([model[o], model[o + 1]]);
    }
    return st;
  }
  function score(user, base) {
    var m = model[base], n = user.length, i, j;
    if (!n || !m || Math.abs(n - m) > LIMIT) return 1e9;
    var cost = new Array(n);
    var off0 = base + 1;
    for (i = 0; i < n; i++) {
      cost[i] = new Array(m);
      for (j = 0; j < m; j++) cost[i][j] = strokeDist(user[i], modelStroke(off0 + j * N * 2));
    }
    var pairs = [];
    for (i = 0; i < n; i++) for (j = 0; j < m; j++) pairs.push([cost[i][j], i, j]);
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    var usedR = {}, usedC = {}, assign = {}, take = Math.min(n, m), p;
    for (p = 0; p < pairs.length && take; p++) {
      i = pairs[p][1]; j = pairs[p][2];
      if (usedR[i] || usedC[j]) continue;
      usedR[i] = usedC[j] = 1;
      assign[i] = j;
      take--;
    }
    var keys = Object.keys(assign), changed = true, a, b, ii, kk, jj, ll;
    while (changed) {
      changed = false;
      for (a = 0; a < keys.length; a++) for (b = a + 1; b < keys.length; b++) {
        ii = +keys[a]; kk = +keys[b];
        jj = assign[ii]; ll = assign[kk];
        if (cost[ii][ll] + cost[kk][jj] < cost[ii][jj] + cost[kk][ll]) {
          assign[ii] = ll; assign[kk] = jj; changed = true;
        }
      }
    }
    var dist = Math.abs(n - m) * PEN;
    for (a = 0; a < keys.length; a++) dist += cost[+keys[a]][assign[keys[a]]];
    return dist / Math.max(n, m);
  }

  function recognize(raw) {
    if (!model || !raw || !raw.length) return [];
    var user = normalize(raw);
    var base = 0, i, s, best = [];
    for (i = 0; i < chars.length; i++) {
      s = score(user, base);
      if (s < 1e8) best.push([s, i]);
      base += 1 + model[base] * N * 2;
    }
    best.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return best.slice(0, TOP).map(function (row) { return chars[row[1]]; });
  }

  function $(id) { return document.getElementById(id); }
  function canvas() { return $('hwCanvas'); }
  function ink() {
    var cs = getComputedStyle(document.documentElement);
    var c = (cs.getPropertyValue('--stroke') || '').trim();
    if (!c) c = getComputedStyle(document.body).color || '#1d1d1f';
    return c;
  }
  function draw() {
    var cv = canvas(), ctx = cv.getContext('2d');
    var w = cv.clientWidth, h = cv.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line') || '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(w / 2, 8, 0.5, h - 16);
    ctx.strokeRect(8, h / 2, w - 16, 0.5);
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink();
    function poly(pts) {
      if (!pts || pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    strokes.forEach(poly);
    if (drawing) poly(drawing);
  }
  function fit() {
    var cv = canvas();
    if (!cv || cv.clientWidth < 2) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    draw();
  }
  function showCands(list) {
    var box = $('hwCands');
    if (!list || !list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(function (ch) {
      return '<button type="button" class="hw-cand" data-hw="' + ch + '">' + ch + '</button>';
    }).join('');
  }
  function refresh() {
    $('hwUndo').disabled = !strokes.length;
    if (!strokes.length) { showCands([]); return; }
    showCands(recognize(strokes));
  }
  function pos(e) {
    var r = canvas().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function length(pts) {
    var d = 0, i, dx, dy;
    for (i = 1; i < pts.length; i++) {
      dx = pts[i].x - pts[i - 1].x; dy = pts[i].y - pts[i - 1].y;
      d += Math.sqrt(dx * dx + dy * dy);
    }
    return d;
  }
  function bind() {
    var cv = canvas();
    fit();
    window.addEventListener('resize', fit);
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (activeId !== null) return;
      activeId = e.pointerId;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      drawing = [pos(e)];
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (e.pointerId !== activeId || !drawing) return;
      var p = pos(e), last = drawing[drawing.length - 1];
      if ((p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y) < 2) return;
      drawing.push(p);
      draw();
      e.preventDefault();
    });
    function endStroke(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      var pts = drawing;
      drawing = null;
      if (pts && length(pts) >= 8) strokes.push(pts);
      draw();
      refresh();
    }
    cv.addEventListener('pointerup', endStroke);
    cv.addEventListener('pointercancel', endStroke);
    $('hwUndo').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!strokes.length) return;
      strokes.pop();
      draw();
      refresh();
    });
    $('hwClear').addEventListener('click', function (e) {
      e.stopPropagation();
      strokes = [];
      drawing = null;
      draw();
      refresh();
    });
    $('hwCands').addEventListener('click', function (e) {
      var btn = e.target.closest('.hw-cand');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      var q = $('q');
      q.value += btn.getAttribute('data-hw');
      if (window.kanjiGc) window.kanjiGc('/hw-pick', 'A handwriting candidate picked', true);
      strokes = [];
      drawing = null;
      draw();
      showCands([]);
      $('hwUndo').disabled = true;
      q.focus();
    });
    $('hwUndo').disabled = true;
  }

  window.KanjiHW = {
    recognize: recognize,
    modelStrokes: function (ch) {
      if (!model) return null;
      var idx = chars.indexOf(ch);
      if (idx < 0) return null;
      var base = 0, i;
      for (i = 0; i < idx; i++) base += 1 + model[base] * N * 2;
      var m = model[base], out = [], j, st, k, o;
      for (j = 0; j < m; j++) {
        st = [];
        for (k = 0; k < N; k++) {
          o = base + 1 + (j * N + k) * 2;
          st.push({ x: model[o], y: model[o + 1] });
        }
        out.push(st);
      }
      return out;
    },
    start: function (characterList, url) {
      chars = characterList;
      var box = $('hwCands');
      box.textContent = 'Loading handwriting…';
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        model = new Uint8Array(buf);
        box.textContent = '';
        bind();
        return window.KanjiHW;
      }).catch(function (err) {
        box.textContent = 'Handwriting data could not be loaded.';
        throw err;
      });
    }
  };
})(window, document);
