import gzip, json, re, os, unicodedata, xml.etree.ElementTree as ET
kd=json.load(open('kd.json'))
SEL=[k for k,v in kd.items() if v['g'] in ('1','2','3','4','5','6','8')]
SEL.sort(key=lambda k:(int(kd[k]['f'] or 9999),int(kd[k]['s'])))
S=set(SEL); OUT='/workspace/kanji-lookup'
os.makedirs(OUT+'/data/strokes',exist_ok=True)
KV='{http://kanjivg.tagaini.net}'
V='aeiouü';M={'a':'āáǎà','e':'ēéěè','i':'īíǐì','o':'ōóǒò','u':'ūúǔù','ü':'ǖǘǚǜ'}
def tone(p):
    p=p.replace('u:','ü').replace('v','ü')
    t=int(p[-1]) if p[-1].isdigit() else 5; s=p.rstrip('012345')
    if t in(5,0): return s
    if 'a' in s: i=s.index('a')
    elif 'e' in s: i=s.index('e')
    elif 'ou' in s: i=s.index('o')
    else: i=max(j for j,c in enumerate(s) if c in V)
    return s[:i]+M[s[i]][t-1]+s[i+1:]
# KanjiVG
comps={}; nostroke=[]
root=ET.parse(gzip.open('kvg.xml.gz')).getroot()
for kj in root.iter('kanji'):
    cid=kj.get('id').split('_')[1]
    if '-' in cid: continue
    ch=chr(int(cid,16))
    if ch not in S: continue
    paths=[p.get('d') for p in kj.iter('path')]
    types=[(p.get(KV+'type') or '')[:1] for p in kj.iter('path')]
    json.dump({'p':paths,'t':''.join(t if t else '?' for t in types)},open(f'{OUT}/data/strokes/{cid}.json','w'),separators=(',',':'))
    g=kj.find('g'); cs=[]
    def walk(n):
        for c in n.findall('g'):
            e=c.get(KV+'element')
            if e: cs.append(e)
            else: walk(c)
    walk(g)
    comps[ch]=[x for x in dict.fromkeys(cs) if x!=ch]
# JMdict examples
cand={k:[] for k in S}
for ev,e in ET.iterparse(gzip.open('JMdict_e.gz'),events=('end',)):
    if e.tag!='entry': continue
    kes=e.findall('k_ele')
    if not kes: e.clear(); continue
    sense=e.find('sense'); gl=[g.text for g in sense.findall('gloss')] if sense is not None else []
    if not gl: e.clear(); continue
    for ki,k0 in enumerate(kes):
        keb=k0.findtext('keb'); pri=[p.text for p in k0.findall('ke_pri')]
        if len(keb)>4: continue
        rank=60 if pri else 200
        for p in pri:
            m=re.match(r'nf(\d\d)',p)
            if m: rank=int(m.group(1))
        score=rank-(3 if 'ichi1' in pri else 0)-(2 if 'news1' in pri else 0)-(2 if ('spec1' in pri or 'spec2' in pri) else 0)+(15 if ki else 0)
        r=None
        for re_ in e.findall('r_ele'):
            if re_.find('re_nokanji') is not None: continue
            rr=[x.text for x in re_.findall('re_restr')]
            if rr and keb not in rr: continue
            r=re_.findtext('reb'); break
        if not r: continue
        kj=[c for c in keb if '\u4e00'<=c<='\u9fff' or c=='々' or ord(c)>0x20000]
        for c in set(kj):
            if c in S:
                other=sum(1 for x in kj if x not in S)
                cand[c].append((score+other*6+(0 if 2<=len(keb)<=3 else 2),keb,r,gl,1 if pri else 0))
    e.clear()
data=[]; nohv=[]; fewex=[]; fewpri=[]
for c in SEL:
    d=kd[c]
    rn=int(d['rad'][0]); rc=unicodedata.normalize('NFKC',chr(0x2F00+rn-1))
    l=sorted(cand[c],key=lambda x:x[0]); seen=set(); exs=[]
    for s,k,r,gl,p in l:
        if k in seen: continue
        if not p and len(exs)>=3: break
        seen.add(k); exs.append([k,r,'; '.join(gl[:3])]+([] if p else [0]))
        if len(exs)==5: break
    if len(exs)<3: fewex.append(c)
    if sum(1 for x in exs if len(x)==3)<3: fewpri.append(c)
    hv=list(dict.fromkeys(x.lower() for x in d['vi']))
    vf=None
    VAR={'剝':'剥','𠮟':'叱'}
    if c in VAR:
        v=kd[VAR[c]]
        if not hv and v['vi']: hv=list(dict.fromkeys(x.lower() for x in v['vi'])); vf=VAR[c]
        if not d['py'] and v['py']: d['py']=v['py']; vf=VAR[c]
    if not hv: nohv.append(c)
    data.append({'k':c,'s':int(d['s']),'g':int(d['g']),'j':int(d['j']) if d['j'] else None,'f':int(d['f']) if d['f'] else None,
      'r':[rn,rc],'c':comps.get(c,[]),'on':d['on'],'kun':d['kun'],'py':[tone(p) for p in d['py']],'hv':hv,'m':d['m'],'ex':exs,**({'vf':vf} if vf else {})})
    if c not in comps: nostroke.append(c)
json.dump(data,open(OUT+'/data/kanji.json','w'),ensure_ascii=False,separators=(',',':'))
gaps={'no_han_viet':nohv,'fewer_than_3_examples':fewex,'no_strokes':nostroke,'fewer_than_3_priority_examples':fewpri,
 'no_pinyin':[x['k'] for x in data if not x['py']],'no_kun':len([x for x in data if not x['kun']])}
json.dump(gaps,open('gaps.json','w'),ensure_ascii=False,indent=1)
print(len(data),{k:(v if isinstance(v,int) else len(v)) for k,v in gaps.items()},gaps['no_han_viet'],gaps['no_pinyin'],gaps['fewer_than_3_examples'][:50])
