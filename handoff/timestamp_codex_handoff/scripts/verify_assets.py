"""Verify extracted data and measured fixed-sample reconstruction, not dynamic dates."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]


def main():
    manifest=json.loads((ROOT/'metadata/manifest.json').read_text(encoding='utf-8'))
    occ=json.loads((ROOT/'metadata/occurrences.json').read_text(encoding='utf-8'))
    byid={o['id']:o for o in occ}
    assert len(byid)==len(occ), 'Duplicate occurrence id'
    groups={}
    for m in manifest['canonical'].values():
        groups.setdefault(m['category'],set()).add(m['text'])
        im=Image.open(ROOT/m['file']); im.load()
        assert im.mode=='RGBA'
        assert list(im.size)==m['size']
        assert im.getchannel('A').getextrema()[1]>80
        assert all(low==high==255 for low,high in im.convert('RGB').getextrema()), 'RGB must remain white'
    assert set('0123456789년월일()')<=groups['date_glyph']
    assert set('0123456789:오전후')<=groups['time_glyph']
    assert set(['오전','오후'])==groups['period_token']
    assert set(f'({c})' for c in '월화수목금토일')==groups['weekday_token']
    for path in (ROOT/'assets').rglob('*.png'):
        with Image.open(path) as im:im.verify()
    for s in manifest['samples']:
        source=ROOT/s['source_file']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==s['sha256'],s['id']+' source hash'
        src=np.asarray(Image.open(source).convert('L'))
        overlay=Image.open(ROOT/s['reference_overlay'])
        assert overlay.mode=='RGBA' and overlay.size==(3240,3240)
        # Reassemble from independently loaded files and measured coordinates.
        a=Image.new('L',overlay.size,0)
        for oid in s['occurrence_ids']:
            o=byid[oid]; g=Image.open(ROOT/o['file']).getchannel('A')
            assert list(g.size)==o['size']
            a.paste(g,tuple(o['source_box'][:2]))
        l=s['logo_specimen']
        a.paste(Image.open(ROOT/l['file']).getchannel('A'),tuple(l['source_box'][:2]))
        aa=np.asarray(a)
        oa=np.asarray(overlay.getchannel('A'))
        assert np.array_equal(aa,oa),s['id']+' partition reconstruction'
        core=src>80
        assert np.array_equal(oa[core],src[core]),s['id']+' source bright-core match'
        date=''.join(byid[oid]['text'] for oid in s['occurrence_ids'] if byid[oid]['line']=='date')
        time=''.join(byid[oid]['text'] for oid in s['occurrence_ids'] if byid[oid]['line']=='time')
        assert date==s['date_text'].replace(' ',''),(s['id'],date)
        assert time==s['time_text'].replace(' ',''),(s['id'],time)
        print(f"PASS {s['id']}: source hash, dimensions, labeled partitions, exact fixed-overlay reconstruction")
    atlasmeta=json.loads((ROOT/'metadata/atlas.json').read_text(encoding='utf-8'))
    atlas=Image.open(ROOT/atlasmeta['file'])
    for key,m in atlasmeta['entries'].items():
        x,y,w,h=m['rect']; raw=Image.open(ROOT/m['file'])
        assert atlas.crop((x,y,x+w,y+h)).tobytes()==raw.tobytes(),key+' atlas pixels'
    print(f"PASS {len(manifest['canonical'])} canonical assets; {len(occ)} occurrences; atlas pixels")
    print('Scope: extracted data/fixed references only. Arbitrary dates, original font/alpha and bright backgrounds are NOT verified.')


if __name__=='__main__':main()
