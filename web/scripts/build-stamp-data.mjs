// Builds public/stamp/ from the same sources the WPF app copies into Resources/.
// Mirrors StampRenderer's constructor: glyph CoreLeft = core_box_in_asset[0] - trim_in_occurrence[0], Y = source_box[1].
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(web, '..');
const handoff = join(repo, 'handoff', 'timestamp_codex_handoff');
const app = join(repo, 'src', 'TimeStamp.App');
const out = join(web, 'public', 'stamp');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = read(join(handoff, 'metadata', 'manifest.json'));
const occurrences = new Map(read(join(handoff, 'metadata', 'occurrences.json')).map((o) => [o.id, o]));
const metrics = read(join(app, 'layout-metrics.json'));
const style = read(join(app, 'stamp-style.json'));
if (style.referenceSize !== 3240) throw new Error('Stamp style must use the 3240px reference canvas.');

if (!out.startsWith(web + sep) || relative(web, out) !== join('public', 'stamp')) throw new Error('Invalid generated stamp output path.');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (file) => {
  const target = join(out, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(handoff, file), target);
  return file;
};

const glyphs = {};
for (const [key, asset] of Object.entries(manifest.canonical)) {
  const occurrence = occurrences.get(asset.source_occurrence_id);
  if (!occurrence) throw new Error('Missing occurrence ' + asset.source_occurrence_id);
  glyphs[key] = {
    file: copy(asset.file),
    coreLeft: occurrence.core_box_in_asset[0] - asset.trim_in_occurrence[0],
    y: asset.source_box[1],
    w: asset.size[0],
    h: asset.size[1],
  };
}

const box = manifest.logo.source_box;
const data = {
  referenceSize: 3240,
  glyphs,
  logo: { file: copy(manifest.logo.file), x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] },
  date: metrics.date.parameters,
  time: metrics.time.parameters,
  textShadow: style.textShadow,
  logoShadow: style.logoShadow,
  samples: manifest.samples.map((s) => ({ id: s.id, datetime: s.datetime_local })),
};
writeFileSync(join(out, 'stamp-data.json'), JSON.stringify(data));
console.log(`stamp data: ${Object.keys(glyphs).length} glyphs → ${out}`);
