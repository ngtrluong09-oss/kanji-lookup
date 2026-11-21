/* Idempotent library merge. Counts are per device (max, then sum). Removals are tombstones with updatedAt. */
(function (root) {
  function sumBy(by) {
    var n = 0;
    Object.keys(by || {}).forEach(function (id) { n += Math.max(0, +by[id] || 0); });
    return n;
  }
  function copyBy(by) {
    var out = {};
    Object.keys(by || {}).forEach(function (id) { out[id] = Math.max(0, +by[id] || 0); });
    return out;
  }
  function normHistoryItem(h, legacyId) {
    if (!h || !h.k) return null;
    var by = {};
    if (h.by && typeof h.by === 'object') by = copyBy(h.by);
    if (!Object.keys(by).length) by[legacyId || 'legacy'] = Math.max(1, +h.n || 1);
    return { k: String(h.k), t: +h.t || 0, u: +h.u || +h.t || 0, n: sumBy(by), by: by, deleted: !!h.deleted };
  }
  function mergeHistoryItem(a, b) {
    var by = copyBy(a.by);
    Object.keys(b.by).forEach(function (id) { by[id] = Math.max(by[id] || 0, b.by[id]); });
    var u = Math.max(a.u || 0, b.u || 0);
    var newer = (b.u || 0) > (a.u || 0) ? b : a;
    var deleted = (a.u || 0) === (b.u || 0) ? !!(a.deleted || b.deleted) : !!newer.deleted;
    return { k: a.k, t: Math.max(a.t || 0, b.t || 0), u: u, n: sumBy(by), by: by, deleted: deleted };
  }
  function normGroupMap(groups, fallbackU) {
    var map = {};
    if (Array.isArray(groups)) {
      groups.forEach(function (id) { if (id) map[String(id)] = { on: true, u: fallbackU || 0 }; });
    } else if (groups && typeof groups === 'object') {
      Object.keys(groups).forEach(function (id) {
        var g = groups[id];
        if (g && typeof g === 'object') map[id] = { on: !!g.on, u: +g.u || 0 };
        else if (g) map[id] = { on: true, u: fallbackU || 0 };
      });
    }
    return map;
  }
  function normFav(f) {
    f = f || {};
    var u = +f.u || +f.t || 0;
    return { t: +f.t || 0, u: u, deleted: !!f.deleted, groups: normGroupMap(f.groups, u) };
  }
  function mergeFav(a, b) {
    var groups = {};
    Object.keys(a.groups).forEach(function (id) { groups[id] = { on: !!a.groups[id].on, u: +a.groups[id].u || 0 }; });
    Object.keys(b.groups).forEach(function (id) {
      var g = b.groups[id], cur = groups[id];
      if (!cur || g.u > cur.u) groups[id] = { on: !!g.on, u: +g.u || 0 };
    });
    var newer = (b.u || 0) > (a.u || 0) ? b : a;
    var deleted = (a.u || 0) === (b.u || 0) ? !!(a.deleted || b.deleted) : !!newer.deleted;
    return { t: Math.max(a.t || 0, b.t || 0), u: Math.max(a.u || 0, b.u || 0), deleted: deleted, groups: groups };
  }
  function normGroup(g) {
    if (!g || !g.id || !g.name) return null;
    return { id: String(g.id), name: String(g.name).slice(0, 60), u: +g.u || 0, deleted: !!g.deleted };
  }
  function cell(c) {
    if (c && typeof c === 'object') return { p: Math.max(0, +c.p || 0), n: Math.max(0, +c.n || 0) };
    return { p: Math.max(0, +c || 0), n: 0 };
  }
  function missTotal(rec) {
    var s = 0;
    Object.keys(rec || {}).forEach(function (id) { s += Math.max(0, (rec[id].p || 0) - (rec[id].n || 0)); });
    return s;
  }
  function normQuiz(q, legacyId) {
    q = q || {};
    var missBy = {};
    var src = q.missBy && typeof q.missBy === 'object' ? q.missBy : {};
    Object.keys(src).forEach(function (k) {
      missBy[k] = {};
      Object.keys(src[k] || {}).forEach(function (id) { missBy[k][id] = cell(src[k][id]); });
    });
    Object.keys(q.miss || {}).forEach(function (k) {
      if (!missBy[k] || !Object.keys(missBy[k]).length) {
        missBy[k] = {};
        missBy[k][legacyId || 'legacy'] = { p: Math.max(0, +q.miss[k] || 0), n: 0 };
      }
    });
    var miss = {};
    Object.keys(missBy).forEach(function (k) { var v = missTotal(missBy[k]); if (v) miss[k] = v; });
    return { best: Math.max(0, +q.best || 0), miss: miss, missBy: missBy };
  }
  function mergeQuiz(a, b) {
    var missBy = {};
    function take(src) {
      Object.keys(src.missBy || {}).forEach(function (k) {
        missBy[k] = missBy[k] || {};
        Object.keys(src.missBy[k]).forEach(function (id) {
          var c = src.missBy[k][id], cur = missBy[k][id];
          if (!cur) missBy[k][id] = { p: c.p, n: c.n };
          else missBy[k][id] = { p: Math.max(cur.p, c.p), n: Math.max(cur.n, c.n) };
        });
      });
    }
    take(a); take(b);
    var miss = {};
    Object.keys(missBy).forEach(function (k) { var v = missTotal(missBy[k]); if (v) miss[k] = v; });
    return { best: Math.max(a.best || 0, b.best || 0), miss: miss, missBy: missBy };
  }
  function libraryOf(raw) {
    if (!raw || typeof raw !== 'object') return {};
    if (raw.data && typeof raw.data === 'object') return raw.data;
    return raw;
  }
  function normalizeStore(raw, legacyId) {
    var s = libraryOf(raw);
    var history = [];
    (Array.isArray(s.history) ? s.history : []).forEach(function (h) {
      var n = normHistoryItem(h, legacyId);
      if (n) history.push(n);
    });
    history.sort(function (a, b) { return (b.t - a.t) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
    var favorites = {};
    var favSrc = s.favorites && typeof s.favorites === 'object' ? s.favorites : {};
    Object.keys(favSrc).forEach(function (k) { favorites[k] = normFav(favSrc[k]); });
    var groups = [];
    (Array.isArray(s.groups) ? s.groups : []).forEach(function (g) { var n = normGroup(g); if (n) groups.push(n); });
    groups.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return {
      version: 1,
      historyClearedAt: +s.historyClearedAt || 0,
      history: history,
      favorites: favorites,
      groups: groups,
      quiz: normQuiz(s.quiz, legacyId)
    };
  }
  function mergeState(local, incoming) {
    local = normalizeStore(local, 'legacy');
    incoming = normalizeStore(incoming, 'legacy');
    var cleared = Math.max(local.historyClearedAt || 0, incoming.historyClearedAt || 0);
    var hmap = {};
    local.history.forEach(function (h) { hmap[h.k] = h; });
    incoming.history.forEach(function (h) { hmap[h.k] = hmap[h.k] ? mergeHistoryItem(hmap[h.k], h) : h; });
    var history = Object.keys(hmap).map(function (k) {
      var h = hmap[k];
      if (h.u < cleared) h.deleted = true;
      return h;
    }).sort(function (a, b) { return b.t - a.t; });
    var gmap = {};
    local.groups.forEach(function (g) { gmap[g.id] = g; });
    incoming.groups.forEach(function (g) {
      var cur = gmap[g.id];
      gmap[g.id] = cur && cur.u >= g.u ? cur : g;
    });
    var favorites = {};
    Object.keys(local.favorites).forEach(function (k) { favorites[k] = local.favorites[k]; });
    Object.keys(incoming.favorites).forEach(function (k) {
      favorites[k] = favorites[k] ? mergeFav(favorites[k], incoming.favorites[k]) : incoming.favorites[k];
    });
    return {
      version: 1,
      historyClearedAt: cleared,
      history: history,
      favorites: favorites,
      groups: Object.keys(gmap).map(function (id) { return gmap[id]; }),
      quiz: mergeQuiz(local.quiz, incoming.quiz)
    };
  }
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  function sameLibrary(a, b) {
    return canonical(normalizeStore(a, 'legacy')) === canonical(normalizeStore(b, 'legacy'));
  }
  root.KanjiMerge = {
    normalizeStore: normalizeStore,
    mergeState: mergeState,
    sameLibrary: sameLibrary,
    normFav: normFav,
    missTotal: missTotal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
