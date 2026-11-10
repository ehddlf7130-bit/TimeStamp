from pathlib import Path
from datetime import datetime
import hashlib
import json
import shutil
from io import BytesIO
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT
UPLOAD = ROOT / 'sources' / 'calibration'
SAMPLES = [
    ('mon', 'IMG_4687.jpeg', '2026-11-09T20:47:00'),
    ('tue', 'IMG_4696(1).jpeg', '2026-11-17T03:55:00'),
    ('wed', 'IMG_4697(1).jpeg', '2026-11-18T10:26:00'),
    ('thu', 'IMG_4698(1).jpeg', '2026-11-19T12:34:00'),
    ('fri', 'IMG_4699(1).jpeg', '2026-11-13T23:49:00'),
    ('sat', 'IMG_4700(1).jpeg', '2026-11-14T00:08:00'),
    ('sun', 'IMG_4701(1).jpeg', '2026-11-15T19:05:00'),
    ('single_digit_date', 'IMG_4695(1).jpeg', '2027-03-03T09:07:00'),
]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def runs(flags):
    edges = np.flatnonzero(np.diff(np.r_[False, flags, False]))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist()))


def alpha_region(gray, box):
    # White foreground on (nearly) black, modeled as grayscale coverage.
    # This is an assumption, NOT recovered original alpha or shadow.
    # Expand before morphology so splitting a line cannot change edge coverage.
    padded = (box[0]-5, box[1]-5, box[2]+5, box[3]+5)
    a = gray.crop(padded)
    core = a.point(lambda v: 255 if v > 12 else 0)
    near = np.asarray(core.filter(ImageFilter.MaxFilter(11))) > 0
    values = np.asarray(a).copy()
    values[(~near) | (values <= 3)] = 0
    return Image.fromarray(values).crop((5,5,5+box[2]-box[0],5+box[3]-box[1]))


def rgba_mask(alpha):
    im = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    im.putalpha(alpha)
    return im


def png(path, im):
    path.parent.mkdir(parents=True, exist_ok=True)
    buf=BytesIO()
    im.save(buf,format='PNG',optimize=True)
    data=buf.getvalue()
    assert data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>50
    tmp=path.with_suffix('.pending')
    tmp.write_bytes(data)
    tmp.replace(path)


def bounds(alpha, threshold=80):
    return alpha.point(lambda v: 255 if v > threshold else 0).getbbox()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        'schema_version': 1,
        'reference_canvas': {'width': 3240, 'height': 3240, 'aspect_ratio': '1:1'},
        'coordinate_convention': 'Pixels, top-left origin, [left, top, right, bottom), exclusive right/bottom',
        'alpha_model': {
            'status': 'estimated_from_black_background',
            'foreground_rgb': [255, 255, 255],
            'coverage': 'JPEG grayscale value / 255; <=3 removed; retain only within 5px of values >12',
            'limitations': ['Original RGB and alpha cannot be separately identified from a black sample.',
                           'Black shadow is unobservable on black.',
                           'JPEG ringing, noise and subpixel glyph variants remain.'],
        },
        'layout_observed': {
            'date_region': [150, 2435, 1700, 2638],
            'time_region': [150, 2640, 1000, 2830],
            'date_core_top_y': 2451,
            'date_first_core_x': 175,
            'same_origin_for_all_samples': True,
            'notes': 'These are observed ink positions, not UIKit text-frame origin, font size, baseline, advance or kerning.',
        },
        'canonical': {}, 'samples': [],
    }
    candidates = {}
    canonical_meta = {}
    occurrences = []
    overlays = []

    def capture(gray, sample_id, category, label, box, line_id, is_partition=True):
        alpha = alpha_region(gray, box)
        code = '_'.join(f'{ord(c):04x}' for c in label)
        serial = len(occurrences)
        rel = f'assets/occurrences/{sample_id}/{line_id}_{serial:03}_{code}.png'
        png(OUT / rel, rgba_mask(alpha))
        ink = bounds(alpha)
        entry = {'id': f'{sample_id}_{line_id}_{serial:03}', 'sample_id': sample_id,
                 'category': category, 'text': label, 'file': rel, 'source_box': list(box),
                 'size': list(alpha.size), 'core_box_in_asset': list(ink) if ink else None,
                 'line': line_id, 'is_partition': is_partition,
                 'advance_px': None, 'baseline_px': None,
                 'metrics_status': 'Source placement is measured; typographic advance/baseline are not inferred.'}
        occurrences.append(entry)
        candidates.setdefault((category, label), []).append(entry)
        return entry

    for sid, filename, iso in SAMPLES:
        src = UPLOAD / f'{sid}.jpeg'
        im = Image.open(src).convert('RGB')
        assert im.size == (3240, 3240), (filename, im.size)
        gray = im.convert('L')
        arr = np.asarray(gray)
        dt = datetime.fromisoformat(iso)
        weekday = '월화수목금토일'[dt.weekday()]
        date_text = f'{dt.year}년 {dt.month}월 {dt.day}일 ({weekday})'
        prefix = '오전' if dt.hour < 12 else '오후'
        time_digits = f'{dt.hour % 12 or 12}:{dt.minute:02d}'
        date_chars = list(f'{dt.year}년{dt.month}월{dt.day}일')
        sample = {'id': sid, 'original_filename': filename, 'datetime_local': iso,
                  'timezone': 'Asia/Seoul', 'date_text': date_text,
                  'time_text': f'{prefix} {time_digits}', 'size': [3240, 3240],
                  'sha256': hashlib.sha256(src.read_bytes()).hexdigest(),
                  'source_file': f'sources/calibration/{sid}.jpeg', 'occurrence_ids': []}
        dest = OUT / sample['source_file']
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dest.resolve(): shutil.copyfile(src, dest)

        full_alpha = Image.new('L', im.size, 0)
        partition_alpha = Image.new('L', im.size, 0)
        for line, y0, y1 in [('date', 2435, 2638), ('time', 2640, 2830)]:
            rr = runs((arr[y0:y1] > 80).sum(0) > 1)
            if line == 'date':
                n = len(date_chars)
                assert len(rr) >= n + 2, (sid, rr)
                groups = [(c, rr[i][0], rr[i][1], 'date_glyph') for i, c in enumerate(date_chars)]
                groups.append((f'({weekday})', rr[n][0], rr[-1][1], 'weekday_token'))
            else:
                assert len(rr) == 2 + len(time_digits), (sid, rr, time_digits)
                groups = [(prefix, rr[0][0], rr[1][1], 'period_token')]
                groups += [(c, rr[i+2][0], rr[i+2][1], 'time_glyph') for i,c in enumerate(time_digits)]
                # Also expose the two Korean glyphs, with their exact source placements.
                for i,c in enumerate(prefix):
                    lb = max(150, rr[i][0]-4)
                    rb = min(rr[i][1]+4, (rr[i][1]+rr[i+1][0])//2)
                    capture(gray, sid, 'time_glyph', c, (lb,y0,rb,y1), line, False)
            # Partition the line at midpoints in blank gaps, retaining faint edges.
            cuts = [max(150, groups[0][1]-5)]
            cuts += [(groups[i][2] + groups[i+1][1])//2 for i in range(len(groups)-1)]
            cuts += [groups[-1][2]+5]
            for i,(label, left, right, cat) in enumerate(groups):
                box=(cuts[i], y0, cuts[i+1], y1)
                entry=capture(gray,sid,cat,label,box,line)
                sample['occurrence_ids'].append(entry['id'])
                a=Image.open(OUT/entry['file']).getchannel('A')
                partition_alpha.paste(a,(box[0],box[1]))
            line_box=(cuts[0],y0,cuts[-1],y1)
            a=alpha_region(gray,line_box)
            full_alpha.paste(a,(line_box[0],line_box[1]))
            cb=bounds(a)
            sample[f'{line}_core_box']=[line_box[0]+cb[0],line_box[1]+cb[1],line_box[0]+cb[2],line_box[1]+cb[3]]
            # Full line specimen: useful as a fixed label and as a visual reference.
            line_rel=f'assets/line_specimens/{sid}_{line}.png'
            png(OUT/line_rel,rgba_mask(a))
            sample[f'{line}_specimen']={'file':line_rel,'source_box':list(line_box)}

        logo_box=(2350,200,3060,405)
        logo_a=alpha_region(gray,logo_box)
        full_alpha.paste(logo_a,(logo_box[0],logo_box[1]))
        partition_alpha.paste(logo_a,(logo_box[0],logo_box[1]))
        logo_rel=f'assets/logo_specimens/{sid}.png'
        png(OUT/logo_rel,rgba_mask(logo_a))
        sample['logo_specimen']={'file':logo_rel,'source_box':list(logo_box)}
        overlay_rel=f'assets/reference_overlays/{sid}.png'
        png(OUT/overlay_rel,rgba_mask(full_alpha))
        sample['reference_overlay']=overlay_rel
        fa=np.asarray(full_alpha,dtype=np.int16)
        pa=np.asarray(partition_alpha,dtype=np.int16)
        core=arr>80
        delta=np.abs(fa-arr.astype(np.int16))
        sample['validation']={
            'partition_vs_full_max_abs_alpha':int(np.abs(fa-pa).max()),
            'source_core_max_abs_luminance':int(delta[core].max()),
            'source_core_mean_abs_luminance':float(delta[core].mean()),
            'full_frame_mean_abs_luminance':float(delta.mean()),
            'meaning':'Fixed reference reconstruction only; not validation of arbitrary dates or bright backgrounds.'}
        if sample['validation']['partition_vs_full_max_abs_alpha']:
            yy,xx=np.unravel_index(np.abs(fa-pa).argmax(),fa.shape)
            print('partition discrepancy',sid,(int(xx),int(yy)),int(fa[yy,xx]),int(pa[yy,xx]))
        assert sample['validation']['partition_vs_full_max_abs_alpha'] == 0
        assert sample['validation']['source_core_max_abs_luminance'] == 0
        manifest['samples'].append(sample)
        overlays.append((sid, im, rgba_mask(full_alpha)))

    # Parentheses from the Monday sample have clean independent projected runs.
    mg=Image.open(UPLOAD/'mon.jpeg').convert('L')
    ma=np.asarray(mg)
    rr=runs((ma[2435:2638]>80).sum(0)>1)
    for label,idx in [('(',10),(')',12)]:
        l,r=rr[idx]
        lb=l-2; rb=r+2
        capture(mg,'mon','date_glyph',label,(lb,2435,rb,2638),'date',False)

    # Prefer exact instances with enough blank margin; preserve all variants separately.
    for (category,label),entries in sorted(candidates.items()):
        selected=max(entries,key=lambda e:e['size'][0])
        raw=Image.open(OUT/selected['file'])
        ink=raw.getchannel('A').point(lambda v:255 if v>12 else 0).getbbox()
        assert ink
        trim=(max(0,ink[0]-2),max(0,ink[1]-2),min(raw.width,ink[2]+2),min(raw.height,ink[3]+2))
        asset=raw.crop(trim)
        code='_'.join(f'{ord(c):04x}' for c in label)
        rel=f'assets/canonical/{category}/{code}.png'
        png(OUT/rel,asset)
        key=f'{category}:{label}'
        meta={'text':label,'category':category,'file':rel,'size':list(asset.size),
              'source_occurrence_id':selected['id'],'source_sample_id':selected['sample_id'],
              'source_box':[selected['source_box'][0]+trim[0],selected['source_box'][1]+trim[1],
                            selected['source_box'][0]+trim[2],selected['source_box'][1]+trim[3]],
              'trim_in_occurrence':list(trim),'advance_px':None,'baseline_px':None,
              'variant_count':len(entries)}
        manifest['canonical'][key]=meta
        canonical_meta[key]=meta

    logo=Image.open(OUT/'assets/logo_specimens/mon.png')
    ink=logo.getchannel('A').point(lambda v:255 if v>12 else 0).getbbox()
    trim=(max(0,ink[0]-3),max(0,ink[1]-3),min(logo.width,ink[2]+3),min(logo.height,ink[3]+3))
    png(OUT/'assets/logo.png',logo.crop(trim))
    manifest['logo']={'file':'assets/logo.png','source_sample_id':'mon',
                      'source_box':[2350+trim[0],200+trim[1],2350+trim[2],200+trim[3]],
                      'contains':'TIME STAMP lettering + clock/postmark icon',
                      'alpha_status':'estimated_white_coverage; original color/opacity not identified'}

    write_json(OUT/'metadata/occurrences.json',occurrences)
    write_json(OUT/'metadata/manifest.json',manifest)
    write_json(OUT/'metadata/validation.json',{'samples':[{ 'id':s['id'],**s['validation']} for s in manifest['samples']],
                                            'dynamic_renderer_implemented':False,
                                            'bright_background_verified':False,
                                            'original_font_identified':False})
    required_date=set('0123456789년월일()')
    required_time=set('0123456789:오전후')
    assert required_date <= {m['text'] for m in canonical_meta.values() if m['category']=='date_glyph'}
    assert required_time <= {m['text'] for m in canonical_meta.values() if m['category']=='time_glyph'}
    assert {f'({c})' for c in '월화수목금토일'} <= {m['text'] for m in canonical_meta.values() if m['category']=='weekday_token'}

    # Exact atlas for programmatic consumption; no resampling of source pixels.
    atlas=Image.new('RGBA',(2048,1024),(255,255,255,0))
    x=y=8; shelf=0; atlas_entries={}
    for key,meta in canonical_meta.items():
        asset=Image.open(OUT/meta['file'])
        if x+asset.width+8>atlas.width: x=8;y+=shelf+8;shelf=0
        assert y+asset.height+8<=atlas.height
        atlas.paste(asset,(x,y))
        atlas_entries[key]={'rect':[x,y,asset.width,asset.height],**meta}
        x+=asset.width+8;shelf=max(shelf,asset.height)
    png(OUT/'assets/atlas.png',atlas)
    write_json(OUT/'metadata/atlas.json',{'file':'assets/atlas.png','size':list(atlas.size),'entries':atlas_entries})

    # Contact sheets are diagnostic visualizations, not retouched originals.
    try:
        font=ImageFont.truetype('DejaVuSans.ttf',16)
        smallfont=ImageFont.truetype('DejaVuSans.ttf',13)
    except OSError:
        font=ImageFont.load_default()
        smallfont=font
    thumb=Image.new('RGB',(1100,1040),(24,26,30));draw=ImageDraw.Draw(thumb)
    for i,(sid,orig,overlay) in enumerate(overlays):
        col=i%2;row=i//2;xx=col*550;yy=row*260
        draw.text((xx+12,yy+8),sid,font=font,fill='white')
        # Only show the lower stamp region at 1/3, rather than empty black canvas.
        strip=orig.crop((140,2415,1680,2845));strip.thumbnail((520,180))
        thumb.paste(strip,(xx+12,yy+40))
    png(OUT/'previews/source_stamps.png',thumb)
    overview=Image.new('RGB',(1200,1600),(32,34,38));draw=ImageDraw.Draw(overview)
    draw.text((20,15),'Extracted assets (source pixels, estimated alpha)',font=font,fill='white')
    for i,(key,meta) in enumerate(canonical_meta.items()):
        xx=20+(i%6)*195;yy=60+(i//6)*195
        asset=Image.open(OUT/meta['file']);asset.thumbnail((177,150))
        tile=Image.new('RGBA',(177,150),(65,68,74,255));tile.alpha_composite(asset,((177-asset.width)//2,(150-asset.height)//2))
        overview.paste(tile.convert('RGB'),(xx,yy))
        cat={'date_glyph':'date','time_glyph':'time','weekday_token':'weekday','period_token':'period'}[meta['category']]
        codes=' '.join(f'{ord(c):04X}' for c in meta['text'] if c not in '()')
        label=cat+' '+codes
        draw.text((xx,yy+155),label,font=smallfont,fill='white')
    png(OUT/'previews/asset_overview.png',overview)
    # Include the original real-photo references for later visual comparison.
    for n in range(4680,4685):
        src=UPLOAD/f'IMG_{n}.jpeg'
        if src.exists():
            dest=OUT/'sources/photo_references'/src.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
    print(json.dumps({'output':str(OUT),'canonical_assets':len(canonical_meta),'occurrences':len(occurrences),
                      'samples':len(SAMPLES),'validation':[s['validation'] for s in manifest['samples']]},ensure_ascii=False))


if __name__=='__main__':main()
