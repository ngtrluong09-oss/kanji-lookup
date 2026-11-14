import gzip, xml.etree.ElementTree as ET, json
root=ET.parse(gzip.open('kanjidic2.xml.gz')).getroot()
out={}
for c in root.iter('character'):
    lit=c.findtext('literal')
    misc=c.find('misc')
    d={'g':misc.findtext('grade'),'s':misc.findtext('stroke_count'),'j':misc.findtext('jlpt'),'f':misc.findtext('freq')}
    d['rad']=[r.text for r in c.iter('rad_value') if r.get('rad_type')=='classical']
    on=[];kun=[];py=[];vi=[];m=[]
    for r in c.iter('reading'):
        t=r.get('r_type')
        if t=='ja_on':on.append(r.text)
        elif t=='ja_kun':kun.append(r.text)
        elif t=='pinyin':py.append(r.text)
        elif t=='vietnam':vi.append(r.text)
    for mm in c.iter('meaning'):
        if mm.get('m_lang') is None: m.append(mm.text)
    d.update(on=on,kun=kun,py=py,vi=vi,m=m)
    out[lit]=d
json.dump(out,open('kd.json','w'),ensure_ascii=False)
import collections
sel={k:v for k,v in out.items() if v['j'] in('4','3')}
print(len(sel), sum(1 for v in sel.values() if not v['vi']))
j=[k for k,v in out.items() if v['g'] in ('1','2','3','4','5','6','8')]
print('joyo',len(j), sum(1 for k in j if not out[k]['vi']))
for k in ['学','日','私','話','行']: print(k,out[k])
