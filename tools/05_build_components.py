#!/usr/bin/env python3
"""Build lazy component data for the detail view and #part/… pages.

Sources (downloaded separately, not committed):
  KanjiVG r20260714 XML          CC BY-SA 3.0   structure, positions, stroke groups
  KRADFILE and RADKFILE          EDRDG CC BY-SA which kanji contain a component
  Kanjium radicals.txt,
    radicals_variants.txt,
    kanjidict.txt, phonetics.txt CC BY-SA 4.0   radical names, phonetic role
  KANJIDIC2 via data/kanji.json  EDRDG CC BY-SA meanings, on'yomi, frequency
  JMdict_e                       EDRDG CC BY-SA common words on the part page

Outputs:
  data/comp/<hex>.json   one kanji's structure (loaded with the detail view)
  data/part/<hex>.json   one component's page (loaded at #part/…)
"""
import gzip, json, os, re
from collections import defaultdict
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KV = '{http://kanjivg.tagaini.net}'
SRC = os.environ.get('COMP_SRC', '/tmp/src')

POS_NAME = {
    'left': 'on the left', 'right': 'on the right', 'top': 'on top', 'bottom': 'at the bottom',
    'middle': 'in the middle', 'kamae': 'as the enclosure', 'kamaec': 'inside the enclosure',
    'nyo': 'wrapping underneath', 'nyoc': 'inside the wrap',
    'tare': 'hanging from the top-left', 'tarec': 'beside the top-left',
}
LAYOUT_FROM_POS = {
    frozenset(['left', 'right']): 'Left–right',
    frozenset(['top', 'bottom']): 'Top–bottom',
    frozenset(['left', 'middle', 'right']): 'Left–middle–right',
    frozenset(['top', 'middle', 'bottom']): 'Top–middle–bottom',
    frozenset(['kamae', 'kamaec']): 'Enclosure',
    frozenset(['kamae']): 'Enclosure',
    frozenset(['nyo', 'nyoc']): 'Bottom-left surround',
    frozenset(['nyo']): 'Bottom-left surround',
    frozenset(['tare', 'tarec']): 'Top-left surround',
    frozenset(['tare']): 'Top-left surround',
}
IDC_LAYOUT = {
    '⿰': 'Left–right', '品l': 'Left–right', '品r': 'Left–right',
    '⿰1': 'Left–right', '⿰2': 'Left–right', '⿰3': 'Left–right', '⿰4': 'Left–right', '⿰5': 'Left–right',
    '⿱': 'Top–bottom', '⿱1': 'Top–bottom', '品u': 'Top–bottom',
    '⿲': 'Left–middle–right', '⿳': 'Top–middle–bottom',
    '囗': 'Enclosure', '⿴': 'Enclosure',
    '⿵': 'Surround from above', '⿶': 'Surround from below', '⿷': 'Surround from the left',
    '⿸': 'Top-left surround', '⿹': 'Top-right surround', '⿺': 'Bottom-left surround',
    '⿻': 'Overlap', '品': 'Stacked',
}
# KanjiVG uses ⻌; Kanjium's table lists the same radical as 辶 / 辶.
ALIAS = {'⻌': '辶', '⻍': '辶', '辶': '辶'}


def hex_of(ch):
    return format(ord(ch), 'x').zfill(5)


def read_tsv(path, encoding='utf-8'):
    rows = []
    with open(path, encoding=encoding) as f:
        for line in f:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            rows.append(line.split('\t'))
    return rows


def load_radicals():
    info = {}
    def add(glyph, meaning, names, number, strokes, variant=False):
        name_list = [n.strip() for n in (names or '').split('・') if n.strip()]
        info[glyph] = {
            'm': (meaning or '').split(';')[0].strip(),
            'jn': name_list[0] if name_list else '',
            'names': name_list,
            'n': int(number) if str(number).isdigit() else None,
            's': int(strokes) if str(strokes).isdigit() else None,
            'var': variant,
        }
    for cols in read_tsv(os.path.join(SRC, 'radicals.txt')):
        if len(cols) < 6:
            continue
        add(cols[0], cols[5], cols[4], cols[2], cols[3], False)
        if cols[1]:
            add(cols[1], cols[5], cols[4], cols[2], cols[3], True)
    for cols in read_tsv(os.path.join(SRC, 'radicals_variants.txt')):
        if len(cols) < 6 or not cols[0]:
            continue
        add(cols[0], cols[5], cols[4], cols[2], cols[3], True)
    for src, dst in ALIAS.items():
        if dst in info and src not in info:
            info[src] = dict(info[dst])
            info[src]['var'] = True
    return info


def load_kanjidict(joyo):
    out = {}
    gloss = {}
    for cols in read_tsv(os.path.join(SRC, 'kanjidict.txt')):
        if not cols or len(cols) < 6:
            continue
        raw = cols[17] if len(cols) > 17 and cols[17] else (cols[16] if len(cols) > 16 else '')
        if raw:
            gloss[cols[0]] = raw.split(';')[0].strip()
        if cols[0] not in joyo:
            continue
        out[cols[0]] = {
            'rad': cols[1],
            'radvar': cols[2],
            'phon': cols[3],
            'idc': cols[4],
            'type': cols[5],
        }
    return out, gloss


def load_krad(joyo):
    contains = defaultdict(set)  # glyph -> set of joyo kanji
    for path in ('kradfile.gz', 'radkfile.gz'):
        fh = gzip.open(os.path.join(SRC, path), 'rt', encoding='euc-jp')
        if path.startswith('krad'):
            for line in fh:
                if not line or line[0] == '#':
                    continue
                if ' : ' not in line:
                    continue
                kanji, rest = line.split(' : ', 1)
                kanji = kanji.strip()
                if kanji not in joyo:
                    continue
                for g in rest.split():
                    contains[g].add(kanji)
        else:
            current = None
            for line in fh:
                if not line or line[0] == '#':
                    continue
                if line[0] == '$':
                    parts = line.split()
                    current = parts[1] if len(parts) > 1 else None
                    continue
                if not current:
                    continue
                for ch in line.strip().split():
                    if ch in joyo:
                        contains[current].add(ch)
        fh.close()
    return contains


def parse_group(g):
    idx = []
    kids = []
    n = 0
    for child in list(g):
        tag = child.tag.split('}')[-1]
        if tag == 'path':
            idx.append(n)
            n += 1
        elif tag == 'g':
            sub = parse_group(child)
            # shift already computed relative indexes
            # parse_group returns indexes starting at 0; shift by n
            def shift(node, off):
                node['i'] = [i + off for i in node['i']]
                for c in node['ch']:
                    shift(c, off)
            shift(sub, n)
            n += sub['n']
            kids.append(sub)
            idx.extend(sub['i'])
    return {
        'g': g.get(KV + 'element') or '',
        'pos': g.get(KV + 'position') or '',
        'rad': g.get(KV + 'radical') or '',
        'i': idx,
        'n': n,
        'ch': kids,
    }


def load_trees(joyo):
    trees = {}
    for ev, el in ET.iterparse(gzip.open(os.path.join(SRC, 'kanjivg.xml.gz'), 'rb'), events=('end',)):
        if el.tag != 'kanji':
            continue
        cid = (el.get('id') or '').split('_')[-1]
        if '-' in cid:
            el.clear()
            continue
        try:
            ch = chr(int(cid, 16))
        except ValueError:
            el.clear()
            continue
        if ch not in joyo:
            el.clear()
            continue
        g = None
        for child in list(el):
            if child.tag.split('}')[-1] == 'g':
                g = child
                break
        if g is not None:
            trees[ch] = parse_group(g)
        el.clear()
    return trees


def first_meaning(d):
    ms = [m for m in d.get('m') or [] if m and not m.startswith('(')]
    return ms[0] if ms else ''


def pick_name(info, pos):
    names = (info or {}).get('names') or []
    if not names:
        return ''
    prefer = {
        'left': ('へん', 'べん'),
        'top': ('かんむり', 'がしら'),
        'bottom': ('あし',),
        'kamae': ('がまえ',),
        'kamaec': ('がまえ',),
        'nyo': ('にょう', 'にゅう'),
        'nyoc': ('にょう', 'にゅう'),
        'tare': ('たれ',),
        'tarec': ('たれ',),
    }.get(pos, ())
    for n in names:
        if any(n.endswith(s) for s in prefer):
            return n
    return names[0]


def label_for(glyph, joyo, radicals, glosses, is_rad, pos):
    info = radicals.get(glyph) or radicals.get(ALIAS.get(glyph, ''))
    if info and info.get('var'):
        return info.get('m') or '', pick_name(info, pos)
    if is_rad and info:
        return info.get('m') or first_meaning(joyo.get(glyph, {})), pick_name(info, pos)
    if glyph in joyo:
        return first_meaning(joyo[glyph]), ''
    if info:
        return info.get('m') or glosses.get(glyph, ''), pick_name(info, pos)
    return glosses.get(glyph, ''), ''


def is_radical_glyph(glyph, node_rad, kd):
    if node_rad in ('general', 'tradit'):
        return True
    if not kd:
        return False
    return glyph and glyph in (kd.get('rad'), kd.get('radvar')) and node_rad in ('general', 'tradit', 'nelson')


def layout_of(node, kd):
    poss = [c['pos'] for c in node['ch'] if c['pos']]
    if poss:
        key = frozenset(poss)
        if key in LAYOUT_FROM_POS:
            return LAYOUT_FROM_POS[key]
        if 'kamae' in key:
            return 'Enclosure'
        if 'nyo' in key:
            return 'Bottom-left surround'
        if 'tare' in key:
            return 'Top-left surround'
        if 'left' in key or 'right' in key:
            return 'Left–right'
        if 'top' in key or 'bottom' in key:
            return 'Top–bottom'
    idc = (kd or {}).get('idc') or ''
    return IDC_LAYOUT.get(idc, '')


def named_children(node):
    """Expand groups that have no element of their own."""
    out = []
    for c in node['ch']:
        if c['g']:
            out.append(c)
        elif c['ch']:
            out.extend(named_children(c))
    return out


def collect_elements(node, into):
    if node['g']:
        into.add(node['g'])
    for c in node['ch']:
        collect_elements(c, into)


def freq(d):
    return d.get('f') or 99999


def main():
    kanji = json.load(open(os.path.join(ROOT, 'data', 'kanji.json'), encoding='utf-8'))
    joyo = {d['k']: d for d in kanji}
    order = {d['k']: i for i, d in enumerate(kanji)}
    radicals = load_radicals()
    kdict, glosses = load_kanjidict(joyo)
    krad = load_krad(joyo)
    print('radicals', len(radicals), 'kanjidict', len(kdict), 'krad glyphs', len(krad), flush=True)
    trees = load_trees(joyo)
    print('trees', len(trees), flush=True)

    contains = defaultdict(set)
    for g, ks in krad.items():
        contains[g].update(ks)
    for ch, node in trees.items():
        els = set()
        collect_elements(node, els)
        for g in els:
            contains[g].add(ch)

    # phonetic families among joyo
    family = defaultdict(list)
    for ch, d in joyo.items():
        kd = kdict.get(ch)
        if kd and kd['phon']:
            family[kd['phon']].append(ch)
    for g in family:
        family[g].sort(key=lambda k: (freq(joyo[k]), order[k]))

    comp_dir = os.path.join(ROOT, 'data', 'comp')
    part_dir = os.path.join(ROOT, 'data', 'part')
    os.makedirs(comp_dir, exist_ok=True)
    os.makedirs(part_dir, exist_ok=True)
    for name in os.listdir(comp_dir):
        if name.endswith('.json'):
            os.remove(os.path.join(comp_dir, name))
    for name in os.listdir(part_dir):
        if name.endswith('.json'):
            os.remove(os.path.join(part_dir, name))

    role_kanji = 0
    phon_kanji = 0
    sem_kanji = 0

    def node_json(node, kd, depth=0):
        glyph = node['g']
        rad = 1 if glyph and node['rad'] in ('general', 'tradit') else 0
        meaning, jn = label_for(glyph, joyo, radicals, glosses, rad, node['pos']) if glyph else ('', '')
        role = ''
        if kd and kd['type'] == 'Phono-semantic compound' and glyph:
            if glyph == kd['phon']:
                role = 'phon'
            elif glyph in (kd['rad'], kd['radvar']) and glyph != kd['phon']:
                role = 'sem'
        kids = []
        seen_sib = set()
        for c in node['ch']:
            group = [c] if c['g'] else named_children(c)
            for sub in group:
                if sub['g'] and sub['g'] in seen_sib and not sub['ch']:
                    continue
                if sub['g']:
                    seen_sib.add(sub['g'])
                kids.append(node_json(sub, kd, depth + 1))
        also = []
        if glyph and glyph in contains:
            for k in sorted(contains[glyph], key=lambda k: (freq(joyo[k]), order.get(k, 9999))):
                if k == glyph:
                    continue
                also.append(k)
                if len(also) == 8:
                    break
        item = {
            'g': glyph,
            'm': meaning,
            's': len(node['i']),
            'i': node['i'],
        }
        if jn:
            item['jn'] = jn
        if node['pos']:
            item['pos'] = POS_NAME.get(node['pos'], node['pos'])
        if role:
            item['role'] = role
        if rad:
            item['rad'] = 1
        if also:
            item['also'] = also
        if kids and depth < 4:
            item['ch'] = kids
        return item

    for ch, d in joyo.items():
        node = trees.get(ch)
        kd = kdict.get(ch) or {}
        if not node or not node['ch']:
            lay = 'Single form'
            summary = ch + ' = ' + (first_meaning(d) or 'one component')
            if kd.get('type'):
                summary_type = kd['type']
            else:
                summary_type = ''
            rec = {'lay': lay, 'sum': summary, 'tree': []}
            if summary_type:
                rec['type'] = summary_type
            json.dump(rec, open(os.path.join(comp_dir, hex_of(ch) + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            continue
        parts = []
        for c in node['ch']:
            if c['g']:
                parts.append(node_json(c, kd))
            else:
                for sub in named_children(c):
                    # keep the group's position on a nameless wrapper
                    if c['pos'] and not sub.get('pos'):
                        sub = dict(sub)
                        sub['pos'] = c['pos']
                    parts.append(node_json(sub, kd))
        lay = layout_of(node, kd)
        bits = []
        for p in parts:
            label = p['g'] or '?'
            extra = []
            if p.get('m'):
                extra.append(p['m'].split(',')[0])
            if p.get('jn'):
                extra.append(p['jn'])
            elif p.get('pos') and 'enclosure' in p['pos']:
                extra.append('enclosure')
            bits.append(label + (' (' + ', '.join(extra) + ')' if extra else ''))
        summary = ch + ' = ' + ' + '.join(bits)
        rec = {'lay': lay or 'Structure not marked', 'sum': summary, 'tree': parts}
        if kd.get('type'):
            rec['type'] = kd['type']
        phon_nodes = []
        def walk_roles(n):
            if n.get('role') == 'phon':
                phon_nodes.append(n['g'])
            for c in n.get('ch') or []:
                walk_roles(c)
        for p in parts:
            walk_roles(p)
        if any(p.get('role') for p in parts) or phon_nodes:
            role_kanji += 1
        if phon_nodes or any(p.get('role') == 'phon' for p in parts):
            phon_kanji += 1
        if any(p.get('role') == 'sem' for p in parts):
            sem_kanji += 1
        fam_key = kd.get('phon') if kd.get('type') == 'Phono-semantic compound' else ''
        if fam_key:
            fam = []
            ons = '、'.join((d.get('on') or [])[:2])
            fam.append([ch, ons])
            for k in family.get(fam_key, []):
                if k == ch:
                    continue
                ons = '、'.join((joyo[k].get('on') or [])[:2])
                fam.append([k, ons])
                if len(fam) == 12:
                    break
            if fam:
                rec['fam'] = fam
                rec['famG'] = fam_key
        json.dump(rec, open(os.path.join(comp_dir, hex_of(ch) + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    # component metadata for part pages (words filled later)
    part_meta = {}
    glyphs = set(contains) | set(radicals)
    for g in glyphs:
        if not g or len(g) != 1 or ord(g) < 128:
            continue
        info = radicals.get(g) or {}
        if info.get('var'):
            meaning, jn = info.get('m') or '', pick_name(info, '')
        elif info:
            meaning = info.get('m') or (first_meaning(joyo[g]) if g in joyo else glosses.get(g, ''))
            jn = ' · '.join((info.get('names') or [])[:3])
        elif g in joyo:
            meaning, jn = first_meaning(joyo[g]), ''
        else:
            meaning, jn = glosses.get(g, ''), ''
        ks = [k for k in contains.get(g, ()) if k in joyo]
        ks.sort(key=lambda k: ((joyo[k].get('s') or 99), freq(joyo[k]), order[k]))
        part_meta[g] = {
            'g': g,
            'm': meaning,
            'jn': jn,
            's': (joyo[g]['s'] if g in joyo else info.get('s') or 0),
            'n': info.get('n'),
            'k': ''.join(ks),
        }
        if g in family and kdict.get(g, {}).get('type') != 'skip':
            fam = []
            for k in family[g]:
                ons = '、'.join((joyo[k].get('on') or [])[:3])
                fam.append([k, ons])
                if len(fam) == 16:
                    break
            if len(fam) >= 2:
                part_meta[g]['fam'] = fam

    print('collecting JMdict words…', flush=True)
    # glyph -> list of (score, word, reading, gloss) trimmed later
    buckets = defaultdict(list)
    # map joyo kanji -> component glyphs we indexed
    kanji_parts = defaultdict(set)
    for g, ks in contains.items():
        for k in ks:
            kanji_parts[k].add(g)

    def consider(word, reading, gloss, score, glyphs_hit, direct):
        for g in glyphs_hit:
            # direct hits sort first via score
            buckets[g].append((score - (8 if g in direct else 0), word, reading, gloss))

    count_entries = 0
    for ev, e in ET.iterparse(gzip.open(os.path.join(SRC, 'JMdict_e.gz'), 'rb'), events=('end',)):
        if e.tag != 'entry':
            continue
        count_entries += 1
        kebs = []
        for ke in e.findall('k_ele'):
            keb = ke.findtext('keb') or ''
            if not keb or len(keb) > 8 or len(keb) < 2:
                continue
            if not any('\u4e00' <= c <= '\u9fff' or ord(c) > 0x20000 for c in keb):
                continue
            pri = [p.text for p in ke.findall('ke_pri') if p.text]
            kebs.append((keb, pri))
        if not kebs:
            e.clear()
            continue
        reb = ''
        for re_ in e.findall('r_ele'):
            if re_.find('re_nokanji') is not None:
                continue
            reb = re_.findtext('reb') or ''
            if reb:
                break
        sense = e.find('sense')
        glosses = [g.text for g in sense.findall('gloss')] if sense is not None else []
        glosses = [g for g in glosses if g][:2]
        if not reb or not glosses:
            e.clear()
            continue
        gloss = '; '.join(glosses)
        if len(gloss) > 90:
            gloss = gloss[:87] + '…'
        for keb, pri in kebs:
            chars = [c for c in keb if c in joyo]
            if not chars:
                continue
            score = 400
            for p in pri:
                if p in ('ichi1', 'news1', 'spec1'):
                    score = min(score, 20)
                elif p in ('ichi2', 'news2', 'spec2'):
                    score = min(score, 40)
                m = re.match(r'nf(\d+)', p)
                if m:
                    score = min(score, int(m.group(1)))
            if score >= 400 and not pri:
                continue  # only common words
            glyphs_hit = set()
            for c in chars:
                glyphs_hit |= kanji_parts.get(c, ())
            if not glyphs_hit:
                continue
            direct = set(c for c in keb if c in glyphs_hit)
            consider(keb, reb, gloss, score + max(0, len(keb) - 3), glyphs_hit, direct)
        e.clear()
    print('  entries', count_entries, 'buckets', len(buckets), flush=True)

    bad = [g for g in part_meta if len(g) != 1]
    if bad:
        print('skip non-characters', bad[:8])
    part_meta = {g: meta for g, meta in part_meta.items() if len(g) == 1}
    for g, meta in part_meta.items():
        rows = buckets.get(g) or []
        best = {}
        for score, word, reading, gloss in rows:
            if word not in best or score < best[word][0]:
                best[word] = (score, reading, gloss)
        ranked = sorted(best.items(), key=lambda kv: (kv[1][0], len(kv[0]), kv[0]))[:40]
        meta['w'] = [[w, reading, gloss] for w, (score, reading, gloss) in ranked]
        json.dump(meta, open(os.path.join(part_dir, hex_of(g) + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    def dir_size(path):
        total = 0
        n = 0
        for name in os.listdir(path):
            if name.endswith('.json'):
                total += os.path.getsize(os.path.join(path, name))
                n += 1
        return n, total

    print('comp', dir_size(comp_dir))
    print('part', dir_size(part_dir))
    print('role kanji', role_kanji, 'with phonetic label', phon_kanji, 'with semantic label', sem_kanji)
    for ch in '内語海間辺情':
        rec = json.load(open(os.path.join(comp_dir, hex_of(ch) + '.json'), encoding='utf-8'))
        print('\n==', ch, rec.get('lay'), '|', rec.get('type'))
        print(rec.get('sum'))
        if rec.get('fam'):
            print(' fam', rec.get('famG'), rec['fam'][:8])
        def brief(n, ind=0):
            print('  ' * ind + n.get('g', '?'), n.get('pos', ''), n.get('role', ''), 'rad' if n.get('rad') else '', n.get('m', '')[:24], n.get('jn', ''))
            for c in n.get('ch') or []:
                brief(c, ind + 1)
        for p in rec.get('tree') or []:
            brief(p)


if __name__ == '__main__':
    main()
