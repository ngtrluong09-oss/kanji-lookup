#!/usr/bin/env python3
"""Build per-kanji example sentences for the site.

Sources (download separately, not committed):
  http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz   Tanaka / Tatoeba B-lines
  http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz       readings when a B-line has none

Output: data/ex/<5-digit hex>.json
  [["annotated sentence","English","t"|"g"], ...]
  t = Tanaka corpus (CC BY 2.0 FR); g = generated, needs review.

Prefer short sentences that contain one of the kanji's example words and whose
B-line is fully indexed (explicit readings). Otherwise derive readings from
JMdict and, for regular verbs, from the dictionary reading plus the surface
okurigana. Sentences that still cannot be read are skipped.
"""
import gzip, json, os, re, sys
from collections import defaultdict
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EX_GZ = os.environ.get('TANAKA_GZ', '/tmp/examples.utf.gz')
JM_GZ = os.environ.get('JMDICT_GZ', '/tmp/JMdict_e.gz')
OUT = os.path.join(ROOT, 'data', 'ex')
KANJI_JSON = os.path.join(ROOT, 'data', 'kanji.json')

# BMP kanji plus Extension B (𠮟) and compatibility ideographs.
KANJI_RE = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ffff]')
HIRA_RE = re.compile(r'^[ぁ-ゖー]+$')
LATIN_RE = re.compile(r'[A-Za-z]')
PUNCT = set('。、！？!?「」『』（）()・…〜～　 \t\n\r.,;:\"\'')


def to_hira(s):
    out = []
    for c in s or '':
        if '\u30a1' <= c <= '\u30f6':
            out.append(chr(ord(c) - 0x60))
        else:
            out.append(c)
    return ''.join(out)


def is_kanji(c):
    o = ord(c)
    return (
        0x4e00 <= o <= 0x9fff or 0x3400 <= o <= 0x4dbf
        or 0x20000 <= o <= 0x2ffff or 0xf900 <= o <= 0xfaff
    )


def parse_token(tok):
    tok = tok.strip().rstrip('~')
    if not tok:
        return None
    surface = None
    m = re.search(r'\{([^}]*)\}', tok)
    if m:
        surface = m.group(1)
        tok = tok[:m.start()] + tok[m.end():]
    tok = re.sub(r'\(#\d+\)', '', tok)
    reading = None
    m = re.search(r'\(([ぁ-ゞァ-ヶー・]+)\)', tok)
    if m:
        reading = to_hira(m.group(1))
        tok = tok[:m.start()] + tok[m.end():]
    tok = re.sub(r'\[\d+\]', '', tok)
    head = tok.strip()
    if not head and not surface:
        return None
    if surface is None:
        surface = head
    explicit = bool(reading) and bool(KANJI_RE.search(surface))
    return head, surface, reading, explicit


def groups_of(s):
    out = []
    i = 0
    while i < len(s):
        kan = is_kanji(s[i])
        j = i + 1
        while j < len(s) and is_kanji(s[j]) == kan:
            j += 1
        out.append((kan, s[i:j]))
        i = j
    return out


def split_reading(head_groups, reading):
    """Slice a dictionary reading into one piece per head group."""
    ri = 0
    parts = []
    for idx, (kan, text) in enumerate(head_groups):
        if not kan:
            th = to_hira(text)
            if reading[ri:ri + len(th)] != th:
                return None
            parts.append(th)
            ri += len(th)
            continue
        nxt = None
        for kan2, text2 in head_groups[idx + 1:]:
            if not kan2:
                nxt = to_hira(text2)
                break
        if nxt is None:
            parts.append(reading[ri:])
            ri = len(reading)
        else:
            k = reading.find(nxt, ri)
            if k <= ri:
                return None
            parts.append(reading[ri:k])
            ri = k
    if ri != len(reading) or any(not p for p in parts):
        return None
    return parts


def apply_reading(head, surface, reading):
    """Dictionary reading + surface form -> reading of the surface, or None."""
    if not surface:
        return None
    if not KANJI_RE.search(surface):
        h = to_hira(surface)
        return h if HIRA_RE.match(h) else None
    if not reading:
        return None
    reading = to_hira(reading)
    if not HIRA_RE.match(reading):
        return None
    if surface == head:
        return reading
    if head in ('来る', '來る') and reading == 'くる':
        special = {
            '来た': 'きた', '来て': 'きて', '来ます': 'きます', '来ません': 'きません',
            '来ました': 'きました', '来ない': 'こない', '来なかった': 'こなかった',
            '来よう': 'こよう', '来れば': 'くれば', '来る': 'くる', '来られる': 'こられる',
            '来ている': 'きている', '来てる': 'きてる', '来ちゃう': 'きちゃう',
        }
        return special.get(surface)
    hg, sg = groups_of(head), groups_of(surface)
    if [t for k, t in hg if k] != [t for k, t in sg if k]:
        return None
    parts = split_reading(hg, reading)
    if not parts:
        return None
    out = []
    hi = si = 0
    while hi < len(hg) or si < len(sg):
        h = hg[hi] if hi < len(hg) else None
        s = sg[si] if si < len(sg) else None
        if h and s and h[0] and s[0]:
            if h[1] != s[1]:
                return None
            out.append(parts[hi])
            hi += 1
            si += 1
        elif h and s and (not h[0]) and (not s[0]):
            out.append(to_hira(s[1]))
            hi += 1
            si += 1
        elif s and not s[0]:
            out.append(to_hira(s[1]))
            si += 1
        else:
            return None
    got = ''.join(out)
    return got if got and HIRA_RE.match(got) else None


def segment_reading(head, words):
    """Reading of a headword, or of its JMdict pieces (峠 + を + 越す)."""
    if head in words:
        return words[head]
    i = 0
    parts = []
    while i < len(head):
        if not is_kanji(head[i]):
            j = i + 1
            while j < len(head) and not is_kanji(head[j]):
                j += 1
            parts.append(to_hira(head[i:j]))
            i = j
            continue
        best = None
        for L in range(min(12, len(head) - i), 0, -1):
            w = head[i:i + L]
            if w in words:
                best = w
                break
        if not best:
            return None
        parts.append(words[best])
        i += len(best)
    got = ''.join(parts)
    return got if got and HIRA_RE.match(got) else None


def annotate(surface, reading):
    """Return surface with kanji[reading] markers, or None if it will not align."""
    if not KANJI_RE.search(surface):
        return surface
    if not reading:
        return None
    reading = to_hira(reading)
    out = []
    si = ri = 0
    while si < len(surface):
        if not is_kanji(surface[si]):
            if ri < len(reading) and to_hira(surface[si]) == reading[ri]:
                out.append(surface[si])
                si += 1
                ri += 1
            else:
                return None
        else:
            sj = si
            while sj < len(surface) and is_kanji(surface[sj]):
                sj += 1
            if sj == len(surface):
                mid = reading[ri:]
                if not mid:
                    return None
                out.append(surface[si:sj] + '[' + mid + ']')
                ri = len(reading)
                si = sj
            else:
                anchor = to_hira(surface[sj])
                k = reading.find(anchor, ri)
                if k <= ri:
                    return None
                out.append(surface[si:sj] + '[' + reading[ri:k] + ']')
                si = sj
                ri = k
    if ri != len(reading):
        return None
    return ''.join(out)


def load_jmdict(path, joyo):
    """keb -> primary hiragana, plus every applicable reading (for compound checks)."""
    print('reading JMdict…', flush=True)
    words = {}
    alts = {}
    n = 0
    for ev, e in ET.iterparse(gzip.open(path, 'rb'), events=('end',)):
        if e.tag != 'entry':
            continue
        n += 1
        kebs = []
        for k in e.findall('k_ele'):
            keb = k.findtext('keb')
            if keb and KANJI_RE.search(keb) and len(keb) <= 16:
                kebs.append(keb)
        if kebs:
            readings = []
            for r in e.findall('r_ele'):
                if r.find('re_nokanji') is not None:
                    continue
                reb = r.findtext('reb')
                if not reb:
                    continue
                restr = [x.text for x in r.findall('re_restr') if x.text]
                readings.append((to_hira(reb), restr))
            for keb in kebs:
                alts.setdefault(keb, set())
                for reb, restr in readings:
                    if restr and keb not in restr:
                        continue
                    alts[keb].add(reb)
                    words.setdefault(keb, reb)
        e.clear()
    print(f'  entries {n}, words {len(words)}', flush=True)
    return words, alts


def content_equal(a, b):
    def norm(s):
        return ''.join(c for c in s if c not in PUNCT)
    return norm(a) == norm(b)


def merge_punct(aline, parts):
    """parts: list of (surface, annotated). Copy punctuation from the A-line."""
    out = []
    ai = 0
    for surface, ann in parts:
        while ai < len(aline) and aline[ai] in PUNCT:
            out.append(aline[ai])
            ai += 1
        if aline[ai:ai + len(surface)] != surface:
            return None
        out.append(ann)
        ai += len(surface)
    while ai < len(aline):
        if aline[ai] in PUNCT:
            out.append(aline[ai])
            ai += 1
        else:
            return None
    return ''.join(out)


def prefix_reading(head, surface, reading):
    """Leading-kanji-run fallback (思った <- 思う). Skips 来る, which it gets wrong."""
    if head in ('来る', '來る') or not reading:
        return None
    reading = to_hira(reading)
    i = 0
    while i < len(head) and i < len(surface) and head[i] == surface[i] and is_kanji(head[i]):
        i += 1
    if i == 0:
        return None
    head_ok, surf_ok = head[i:], surface[i:]
    if KANJI_RE.search(head_ok) or KANJI_RE.search(surf_ok):
        return None
    head_ok, surf_ok = to_hira(head_ok), to_hira(surf_ok)
    if head_ok and not reading.endswith(head_ok):
        return None
    stem = reading[:-len(head_ok)] if head_ok else reading
    out = stem + surf_ok
    return out if out and HIRA_RE.match(out) else None


def reading_for(head, surface, reading, words):
    if not KANJI_RE.search(surface):
        return reading
    # Prefer the headword's own reading. Segmenting the conjugated surface
    # (食べた -> 食 + べた) picks the wrong reading and blocks the real one.
    base = reading or words.get(head) or words.get(surface) or segment_reading(head, words)
    if not base:
        return None
    for cand in (apply_reading(head, surface, base), prefix_reading(head, surface, base)):
        if cand and annotate(surface, cand):
            return cand
    if surface == head:
        h = to_hira(base)
        if annotate(surface, h):
            return h
    return None


def annotate_gap(gap, words, joyo_read):
    """Longest-match JMdict readings for text the B-line left out (often names)."""
    out = []
    i = 0
    saw_kanji = False
    while i < len(gap):
        ch = gap[i]
        if not is_kanji(ch):
            j = i + 1
            while j < len(gap) and not is_kanji(gap[j]):
                j += 1
            out.append(gap[i:j])
            i = j
            continue
        saw_kanji = True
        best = None
        for L in range(min(12, len(gap) - i), 0, -1):
            w = gap[i:i + L]
            if w in words:
                best = w
                break
        if best:
            ann = annotate(best, words[best])
            if not ann:
                return None
            out.append(ann)
            i += len(best)
            continue
        rd = joyo_read.get(ch)
        if not rd:
            return None
        out.append(ch + '[' + rd + ']')
        i += 1
    return ''.join(out), saw_kanji


def align_parts(jp, parts, words, joyo_read):
    """Align B-line surfaces onto the A-line, filling gaps from JMdict."""
    if content_equal(jp, ''.join(s for s, _ in parts)):
        return merge_punct(jp, parts), False
    out = []
    ai = 0
    gap_kanji = False
    for surface, ann in parts:
        pos = jp.find(surface, ai)
        if pos < 0:
            return None, False
        gap = jp[ai:pos]
        if gap:
            filled = annotate_gap(gap, words, joyo_read)
            if not filled or filled[0] is None:
                return None, False
            out.append(filled[0])
            gap_kanji = gap_kanji or filled[1]
        out.append(ann)
        ai = pos + len(surface)
    tail = jp[ai:]
    if tail:
        if all(c in PUNCT for c in tail):
            out.append(tail)
        else:
            filled = annotate_gap(tail, words, joyo_read)
            if not filled or filled[0] is None:
                return None, False
            out.append(filled[0])
            gap_kanji = gap_kanji or filled[1]
    return ''.join(out), gap_kanji


def fix_compounds(ann, words, alts):
    """If the B-line split 毎日 into 毎[まい]日[ひ], use the word reading まいにち.

    A split is kept when the concatenated reading is itself a real reading
    (人気 as ひとけ, not only にんき).
    """
    parts = []
    i = 0
    kanji_run = re.compile(r'([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ffff]+)\[([^\]]+)\]')
    while i < len(ann):
        m = kanji_run.match(ann, i)
        if m:
            parts.append(('k', m.group(1), m.group(2)))
            i = m.end()
        else:
            parts.append(('c', ann[i], ''))
            i += 1
    out = []
    i = 0
    fixed = 0
    while i < len(parts):
        if parts[i][0] != 'k':
            out.append(parts[i][1])
            i += 1
            continue
        j = i
        while j < len(parts) and parts[j][0] == 'k':
            j += 1
        k = i
        while k < j:
            best = None
            for L in range(j - k, 1, -1):
                surf = ''.join(parts[k + t][1] for t in range(L))
                concat = ''.join(parts[k + t][2] for t in range(L))
                if surf in alts and concat not in alts[surf]:
                    best = (L, surf, words[surf])
                    break
            if best:
                out.append(best[1] + '[' + best[2] + ']')
                k += best[0]
                fixed += 1
            else:
                out.append(parts[k][1] + '[' + parts[k][2] + ']')
                k += 1
        i = j
    return ''.join(out), fixed


def load_sentences(path, words, joyo, joyo_read, alts):
    print('reading Tanaka examples…', flush=True)
    sents = []
    index = defaultdict(list)
    skipped = defaultdict(int)
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as f:
        aline = None
        for line in f:
            if line.startswith('A:'):
                aline = line[2:].strip()
                continue
            if not line.startswith('B:') or not aline:
                continue
            if '\t' not in aline:
                aline = None
                continue
            jp, en = aline.split('\t', 1)
            jp = jp.strip()
            en = re.sub(r'\s*#ID=.*$', '', en).strip()
            aline = None
            if not jp or not en or len(jp) < 4 or len(jp) > 56 or len(en) > 160:
                skipped['len'] += 1
                continue
            if LATIN_RE.search(jp) or '※' in jp or 'http' in en.lower():
                skipped['bad'] += 1
                continue
            if not any(c in joyo for c in jp):
                skipped['nojoyo'] += 1
                continue
            parts = []
            explicit = True
            ok = True
            saw_kanji_token = False
            for raw in line[2:].split():
                p = parse_token(raw)
                if not p:
                    continue
                head, surface, reading, exp = p
                if not surface:
                    ok = False
                    break
                if KANJI_RE.search(surface):
                    saw_kanji_token = True
                    if not exp:
                        explicit = False
                    reading = reading_for(head, surface, reading, words)
                    if not reading:
                        ok = False
                        break
                ann = annotate(surface, reading)
                if ann is None:
                    ok = False
                    break
                parts.append((surface, ann))
            if not ok or not parts:
                skipped['read'] += 1
                continue
            merged, gap_kanji = align_parts(jp, parts, words, joyo_read)
            if not merged or '[' not in merged:
                skipped['align'] += 1
                continue
            merged, _nfix = fix_compounds(merged, words, alts)
            if gap_kanji:
                explicit = False
            if not saw_kanji_token and not gap_kanji:
                skipped['nokanji'] += 1
                continue
            i = len(sents)
            sents.append((merged, en, jp, explicit))
            seen = set()
            for c in jp:
                if c in joyo and c not in seen:
                    seen.add(c)
                    index[c].append(i)
    print(f'  usable {len(sents)} skipped {dict(skipped)}', flush=True)
    return sents, index


def first_gloss(gloss):
    g = gloss.split(';')[0]
    g = re.sub(r'\([^)]*\)', '', g).strip().strip('.').strip()
    return g


def generate(entry):
    """One simple sentence from an example word. Flagged for review."""
    k = entry['k']
    for ex in entry['ex']:
        word, reading, gloss = ex[0], ex[1], ex[2]
        if k not in word:
            continue
        ann = annotate(word, to_hira(reading))
        if not ann:
            continue
        g = first_gloss(gloss)
        if not g:
            continue
        low = re.sub(r'\s+', ' ', g).strip().lower()
        # Conjunctions and bare verbs are not "this is a …" nouns.
        if low.startswith('to ') or low in ('but', 'and', 'or', 'however', 'moreover', 'also', 'furthermore'):
            en = (g[0].upper() + g[1:]).rstrip('.') + '.'
            return [ann + '。', en, 'g']
        if re.match(r'^(a|an|the)\b', low):
            noun = low
        elif re.match(r'^[aeiou]', low):
            noun = 'an ' + low
        else:
            noun = 'a ' + low
        return ['これは' + ann + 'です。', 'This is ' + noun + '.', 'g']
    # Bare kanji using the kun or on reading.
    kun = [r for r in entry.get('kun') or [] if not r.startswith('-')]
    reading = None
    if kun:
        reading = to_hira(re.sub(r'[.\-]', '', kun[0]))
    elif entry.get('on'):
        reading = to_hira(entry['on'][0])
    meanings = [m for m in entry['m'] if not m.startswith('(')]
    if reading and meanings and HIRA_RE.match(reading):
        g = first_gloss(meanings[0])
        if g and not g.lower().startswith('to '):
            return [k + '[' + reading + ']。', g[0].upper() + g[1:] + '.', 'g']
    return None


def pick(entry, sents, index):
    k = entry['k']
    words = [ex[0] for ex in entry['ex'] if ex and ex[0]]
    best = []
    for i in index.get(k, ()):
        merged, en, jp, explicit = sents[i]
        if k not in jp:
            continue
        L = len(jp)
        hit = next((w for w in words if w in jp), None)
        if L > 48 and not hit:
            continue
        sc = 0
        if hit:
            sc += 120 + min(len(hit), 8)
        if L <= 20:
            sc += 50
        elif L <= 28:
            sc += 18
        else:
            sc -= (L - 28) * 3
        if explicit:
            sc += 28  # fully indexed B-line readings
        if jp.startswith('彼') or jp.startswith('私は'):
            sc -= 14
        sc -= L * 0.25
        # Prefer an actual sentence ending.
        if jp.endswith('。') or jp.endswith('？'):
            sc += 4
        best.append((sc, -L, i, hit))
    best.sort(reverse=True)
    chosen = []
    used_hits = set()
    used_i = set()
    # First pass: example-word hits only, if any exist.
    has_hit = any(h for *_, h in best)
    for sc, negL, i, hit in best:
        if has_hit and not hit:
            continue
        if i in used_i:
            continue
        if hit and hit in used_hits and len(chosen) < 2:
            continue
        chosen.append(sents[i])
        used_i.add(i)
        if hit:
            used_hits.add(hit)
        if len(chosen) == 2:
            break
    if len(chosen) < 1:
        # Rare kanji: shortest readable sentence, even without an example-word hit.
        for sc, negL, i, hit in sorted(best, key=lambda r: (r[1], -r[0])):
            chosen.append(sents[i])
            if len(chosen) == 2:
                break
    elif len(chosen) < 2:
        for sc, negL, i, hit in best:
            if i in used_i:
                continue
            if has_hit and not hit:
                continue
            chosen.append(sents[i])
            used_i.add(i)
            if len(chosen) == 2:
                break
    rows = []
    for merged, en, jp, explicit in chosen:
        rows.append([merged, en, 't'])
    return rows


def main():
    data = json.load(open(KANJI_JSON, encoding='utf-8'))
    joyo = set(d['k'] for d in data)
    # self-check the furigana aligner
    assert annotate('水', 'みず') == '水[みず]'
    assert annotate('難しい', 'むずかしい') == '難[むずか]しい'
    assert annotate('持ち歩く', 'もちあるく') == '持[も]ち歩[ある]く'
    assert apply_reading('思う', '思った', 'おもう') == 'おもった'
    assert apply_reading('行く', '行った', 'いく') == 'いった'
    assert apply_reading('食べる', '食べた', 'たべる') == 'たべた'
    assert apply_reading('引き継ぐ', '引き継ぎます', 'ひきつぐ') == 'ひきつぎます'
    assert apply_reading('峠を越す', '峠を越した', 'とうげをこす') == 'とうげをこした'
    words, alts = load_jmdict(JM_GZ, joyo)
    joyo_read = {}
    for d in data:
        for ex in d['ex']:
            words.setdefault(ex[0], to_hira(ex[1]))
        kun = [r for r in (d.get('kun') or []) if not str(r).startswith('-')]
        rd = None
        if kun:
            rd = to_hira(re.sub(r'[.\-]', '', kun[0]))
        elif d.get('on'):
            rd = to_hira(d['on'][0])
        if rd and HIRA_RE.match(rd):
            joyo_read[d['k']] = rd
    sents, index = load_sentences(EX_GZ, words, joyo, joyo_read, alts)
    os.makedirs(OUT, exist_ok=True)
    # Remove stale shards so a kanji that lost its file does not linger.
    for name in os.listdir(OUT):
        if name.endswith('.json'):
            os.remove(os.path.join(OUT, name))
    n_t = n_g = n_empty = n_one = 0
    gen_list = []
    short = 0
    for d in data:
        rows = pick(d, sents, index)
        if not rows:
            g = generate(d)
            if g:
                rows = [g]
                n_g += 1
                gen_list.append(d['k'])
            else:
                n_empty += 1
                gen_list.append(d['k'] + '?')
        else:
            n_t += 1
            if len(rows) == 1:
                n_one += 1
        for row in rows:
            # length of the plain sentence (drop bracket readings)
            plain = re.sub(r'\[[^\]]+\]', '', row[0])
            if len(plain) <= 20:
                short += 1
        h = format(ord(d['k']), 'x')
        h = h.zfill(5)
        with open(os.path.join(OUT, h + '.json'), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
    print(f'kanji with corpus sentences: {n_t} (only one: {n_one})')
    print(f'generated: {n_g} empty: {n_empty}')
    print('generated kanji:', ''.join(gen_list))
    print(f'sentence rows <=20 chars: {short}')


if __name__ == '__main__':
    sys.exit(main())
