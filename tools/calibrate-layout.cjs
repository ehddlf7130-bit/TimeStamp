// Infer horizontal advances and ink bearings from measured sample positions.
// Ridge priors resolve parameters that the eight samples cannot identify alone.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../handoff/timestamp_codex_handoff');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'metadata/manifest.json')));
const occurrences = JSON.parse(fs.readFileSync(path.join(root, 'metadata/occurrences.json')));
function solve(a, b) {
  a = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < b.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < b.length; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const d = a[i][i]; for (let k = i; k <= b.length; k++) a[i][k] /= d;
    for (let j = 0; j < b.length; j++) if (j !== i) {
      const factor = a[j][i]; for (let k = i; k <= b.length; k++) a[j][k] -= factor * a[i][k];
    }
  }
  return a.map(row => row[b.length]);
}
function tokens(sample, line) {
  return line === 'date'
    ? sample.date_text.match(/\([^)]*\)|\s|./gu)
    : sample.time_text.match(/오전|오후|\s|./gu);
}
function group(token) { return /^\d$/.test(token) ? 'digit' : token.startsWith('오') ? 'period' : token.startsWith('(') ? 'weekday' : token; }
function fit(line, excluded) {
  const groups = line === 'date' ? ['digit', '년', '월', '일', ' '] : ['digit', 'period', ':', ' '];
  const currentTokens = [...new Set(manifest.samples.flatMap(s => tokens(s, line)).filter(t => t !== ' '))];
  const keys = [...groups.map(t => 'advance:' + t), ...currentTokens.map(t => 'bearing:' + t)];
  const prior = keys.map(k => k.startsWith('bearing:') ? (/\d/.test(k) ? (k.endsWith('1') ? 28 : 5) : 12)
    : k.endsWith('digit') ? 83.4 : k.endsWith('period') ? 290 : k.endsWith(':') ? 34 : k.endsWith(' ') ? 40 : 145);
  const rows = [];
  for (const s of manifest.samples) {
    const os = occurrences.filter(o => o.sample_id === s.id && o.line === line && o.is_partition);
    const counts = Object.fromEntries(groups.map(g => [g, 0])); let index = 0;
    for (const token of tokens(s, line)) {
      if (token !== ' ') {
        const o = os[index++];
        if (o.text !== token) throw Error(`Token mismatch ${s.id} ${o.text} ${token}`);
        const x = keys.map(k => k.startsWith('advance:') ? counts[k.slice(8)] : +(k === 'bearing:' + token));
        rows.push({id:s.id, x, y:o.source_box[0] + o.core_box_in_asset[0] - (line === 'date' ? 170 : 172)});
      }
      const g = group(token); if (g in counts) counts[g]++;
    }
  }
  const a = keys.map((_, i) => keys.map((_, j) => i === j ? 0.1 : 0));
  const b = prior.map(v => v * 0.1);
  for (const row of rows.filter(r => r.id !== excluded)) for (let i = 0; i < keys.length; i++) {
    b[i] += row.x[i] * row.y;
    for (let j = 0; j < keys.length; j++) a[i][j] += row.x[i] * row.x[j];
  }
  const weights = solve(a,b);
  const errors = rows.filter(r => !excluded || r.id === excluded).map(r => Math.abs(r.y - r.x.reduce((sum,v,i) => sum + v*weights[i],0)));
  return {parameters:Object.fromEntries(keys.map((k,i)=>[k,weights[i]])), meanCoreXError:errors.reduce((a,b)=>a+b,0)/errors.length, maxCoreXError:Math.max(...errors)};
}
const result = {status:'Estimated from black samples; original font and shadow unknown.',date:fit('date'),time:fit('time'),holdout:manifest.samples.map(s=>({id:s.id,date:fit('date',s.id),time:fit('time',s.id)})).map(s=>({id:s.id,dateMean:s.date.meanCoreXError,dateMax:s.date.maxCoreXError,timeMean:s.time.meanCoreXError,timeMax:s.time.maxCoreXError}))};
fs.writeFileSync(path.resolve(__dirname,'../src/TimeStamp.App/layout-metrics.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({date:result.date,time:result.time,holdout:result.holdout},null,2));
