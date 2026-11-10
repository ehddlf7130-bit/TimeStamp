// 스탬프 찍기: the WPF app's batch flow — pick photos, place them on the 5-minute slots, export.
import { arrange, assign, exportName, stampDate, stampTime, type Wall } from '../core/patrol';
import { clear, errorMessage, h, loadFileImage, toast } from '../dom';
import { canShareFiles, download, makeZip, shareFiles, type NamedBlob } from '../stamp/export';
import { canvasToBlob, centerCrop, makeCanvas, release, type StampRenderer } from '../stamp/renderer';
import { PlanForm, planFrom, type PlanInputs } from './planform';

interface Photo { id: number; file: File; key: string; w: number; h: number; thumb: string }
interface Slot { time: Wall; photo: Photo | null }

const MAX_SIDE = 12000;
/** iOS Safari refuses canvases much above 4096², so "원본" is capped here. */
const MAX_CANVAS = 4096;
let nextId = 1;

export class BatchPage {
  readonly el: HTMLElement;
  private form: PlanForm;
  private photos: Photo[] = [];
  private slots: Slot[] = [];
  private selectedPhoto: Photo | null = null;
  private selectedSlot = -1;
  private busy = false;

  private fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  private cropOther = h('input', { type: 'checkbox' });
  private photoStrip = h('div', { class: 'strip' });
  private photoCount = h('span', { class: 'muted' });
  private slotList = h('ol', { class: 'slot-list' });
  private slotCount = h('span', { class: 'muted' });
  private preview = h('canvas', { class: 'preview', width: 640, height: 640 });
  private previewCaption = h('p', { class: 'caption' });
  private assignBtn = h('button', { class: 'secondary', onclick: () => this.assignSelected() }, '선택 사진을 이 시간에 배치');
  private clearBtn = h('button', { class: 'ghost', onclick: () => this.clearSlot() }, '이 시간 비우기');
  private size = h('select', null, ['3240', '1080', '1536', '0'].map((v) => h('option', { value: v, selected: v === '3240' }, v === '0' ? '원본 크기' : `${v} × ${v}${v === '3240' ? ' (원본과 동일)' : ''}`)));
  private format = h('select', null, h('option', { value: 'jpg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'));
  private shareBtn = h('button', { class: 'primary', onclick: () => this.export('share') }, '모두 저장 (공유)');
  private zipBtn = h('button', { class: 'secondary', onclick: () => this.export('zip') }, 'ZIP 다운로드');
  private status = h('p', { class: 'status' });

  constructor(inputs: PlanInputs, private renderer: StampRenderer) {
    this.form = new PlanForm(inputs);
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      void this.addFiles(files);
    });
    this.el = h('section', { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, '스탬프 찍기'), h('p', null, '갤러리 사진을 5분 간격 시간에 배치하고 한꺼번에 스탬프를 찍습니다.')),
      h('div', { class: 'card' }, this.form.el, h('button', { class: 'secondary block', onclick: () => this.applyPlan(true) }, '시간 적용')),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, '사진'), this.photoCount),
        h('div', { class: 'row2' },
          h('button', { class: 'primary', onclick: () => this.fileInput.click() }, '사진 선택'),
          h('button', { class: 'ghost', onclick: () => this.removePhoto() }, '선택 사진 제외')),
        h('label', { class: 'check' }, this.cropOther, h('span', null, '1:1이 아닌 사진은 가운데를 잘라 사용')),
        this.photoStrip, this.fileInput),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, '배치'), this.slotCount),
        h('div', { class: 'row2' },
          h('button', { class: 'secondary', onclick: () => this.arrange(false) }, '순서대로'),
          h('button', { class: 'secondary', onclick: () => this.arrange(true) }, '랜덤 배치')),
        h('div', { class: 'preview-wrap' }, this.preview), this.previewCaption,
        h('div', { class: 'row2' }, this.assignBtn, this.clearBtn),
        this.slotList),
      h('div', { class: 'card' },
        h('h2', null, '내보내기'),
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, h('span', null, '해상도'), this.size),
          h('label', { class: 'field' }, h('span', null, '형식'), this.format)),
        h('div', { class: 'row2' }, this.shareBtn, this.zipBtn),
        this.status),
    );
    this.applyPlan(false);
  }

  setInputs(inputs: PlanInputs) {
    this.form.set(inputs);
    this.applyPlan(false);
  }

  /** Changing the range keeps placements whose date and time match exactly. */
  private applyPlan(report: boolean) {
    let times: Wall[];
    try { times = planFrom(this.form.get()).slots; }
    catch (e) { if (report) toast(errorMessage(e)); return; }
    const kept = new Map(this.slots.filter((s) => s.photo).map((s) => [s.time.getTime(), s.photo!]));
    this.slots = times.map((time) => ({ time, photo: kept.get(time.getTime()) ?? null }));
    this.selectedSlot = this.slots.length ? 0 : -1;
    if (report) toast(`${this.slots.length}개 시간을 적용했습니다.`);
    this.refresh();
  }

  private async addFiles(files: File[]) {
    if (!files.length || this.busy) return;
    this.setBusy(true);
    const skipped: string[] = [];
    let added = 0;
    for (const [i, file] of files.entries()) {
      this.status.textContent = `사진 불러오는 중… ${i + 1} / ${files.length}`;
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (this.photos.some((p) => p.key === key)) continue;
      try {
        const img = await loadFileImage(file);
        const w = img.naturalWidth, hgt = img.naturalHeight;
        if (w !== hgt && !this.cropOther.checked) throw new Error(`1:1 사진만 입력할 수 있습니다. (${w} × ${hgt})`);
        if (w < 1 || w > MAX_SIDE || hgt > MAX_SIDE) throw new Error('사진 크기는 한 변 1~12,000픽셀까지 지원합니다.');
        const c = centerCrop(w, hgt);
        const thumb = makeCanvas(160, 160);
        thumb.getContext('2d')!.drawImage(img, c.sx, c.sy, c.s, c.s, 0, 0, 160, 160);
        const url = URL.createObjectURL(await canvasToBlob(thumb, false));
        release(thumb);
        this.photos.push({ id: nextId++, file, key, w, h: hgt, thumb: url });
        added++;
      } catch (e) {
        skipped.push(`${file.name}: ${errorMessage(e)}`);
      }
    }
    this.setBusy(false);
    this.status.textContent = '';
    if (skipped.length) alert(`${skipped.length}개 파일을 건너뛰었습니다.\n\n${skipped.join('\n')}`);
    else if (added) toast(`사진 ${added}장을 추가했습니다.`);
    this.refresh();
  }

  private removePhoto() {
    const p = this.selectedPhoto;
    if (!p) return toast('제외할 사진을 먼저 선택해 주세요.');
    this.photos = this.photos.filter((x) => x !== p);
    for (const s of this.slots) if (s.photo === p) s.photo = null;
    URL.revokeObjectURL(p.thumb);
    this.selectedPhoto = null;
    this.refresh();
  }

  private arrange(random: boolean) {
    if (!this.photos.length) return toast('사진을 먼저 선택해 주세요.');
    const placement = arrange(this.slots.length, this.photos.length, random);
    placement.forEach((p, i) => (this.slots[i].photo = p === null ? null : this.photos[p]));
    this.refresh();
  }

  private assignSelected() {
    if (!this.selectedPhoto || this.selectedSlot < 0) return toast('사진과 시간을 각각 선택해 주세요.');
    const arr = this.slots.map((s) => s.photo);
    assign(arr, this.selectedSlot, this.selectedPhoto);
    arr.forEach((p, i) => (this.slots[i].photo = p));
    this.refresh();
  }

  private clearSlot() {
    if (this.selectedSlot < 0) return;
    this.slots[this.selectedSlot].photo = null;
    this.refresh();
  }

  private refresh() {
    const placed = new Set(this.slots.map((s) => s.photo).filter(Boolean));
    this.photoCount.textContent = `${this.photos.length}장 · 대기 ${this.photos.filter((p) => !placed.has(p)).length}장`;
    clear(this.photoStrip, this.photos.length ? this.photos.map((p) => h('button', {
      class: `thumb${p === this.selectedPhoto ? ' selected' : ''}${placed.has(p) ? ' placed' : ''}`,
      onclick: () => { this.selectedPhoto = p === this.selectedPhoto ? null : p; this.refresh(); },
    }, h('img', { src: p.thumb, alt: p.file.name }))) : h('p', { class: 'empty' }, '선택한 사진이 없습니다. 1:1 사진을 선택해 주세요.'));

    const empty = this.slots.filter((s) => !s.photo).length;
    this.slotCount.textContent = empty ? `${this.slots.length}개 시간 · 빈 시간 ${empty}개` : `${this.slots.length}개 시간 · 모두 배치됨`;
    clear(this.slotList, this.slots.map((s, i) => h('li', null, h('button', {
      class: `slot${i === this.selectedSlot ? ' selected' : ''}${s.photo ? '' : ' empty'}`,
      onclick: () => { this.selectedSlot = i; this.refresh(); },
    },
    h('span', { class: 'idx' }, String(i + 1).padStart(3, '0')),
    s.photo ? h('img', { src: s.photo.thumb, alt: '' }) : h('span', { class: 'hole' }),
    h('span', { class: 'when' }, h('b', null, stampTime(s.time)), h('small', null, stampDate(s.time)))))));

    const ready = this.slots.length > 0 && empty === 0;
    for (const b of [this.shareBtn, this.zipBtn]) b.disabled = this.busy || !ready;
    if (!this.busy) this.status.textContent = ready ? '' : this.slots.length ? `빈 시간 ${empty}개에 사진을 배치해야 내보낼 수 있습니다.` : '';
    void this.drawPreview();
  }

  private previewToken = 0;
  private async drawPreview() {
    const token = ++this.previewToken;
    const slot = this.slots[this.selectedSlot];
    const ctx = this.preview.getContext('2d')!;
    if (!slot) { ctx.clearRect(0, 0, 640, 640); this.previewCaption.textContent = '시간을 적용해 주세요.'; return; }
    this.previewCaption.textContent = `${String(this.selectedSlot + 1).padStart(3, '0')} · ${stampDate(slot.time)} ${stampTime(slot.time)}${slot.photo ? '' : ' · 비어 있음'}`;
    let source: CanvasImageSource, crop;
    if (slot.photo) {
      const img = await loadFileImage(slot.photo.file).catch(() => null);
      if (!img || token !== this.previewToken) return;
      source = img; crop = centerCrop(img.naturalWidth, img.naturalHeight);
    } else {
      const grey = makeCanvas(1, 1); const g = grey.getContext('2d')!; g.fillStyle = '#5b6b72'; g.fillRect(0, 0, 1, 1);
      source = grey; crop = { sx: 0, sy: 0, s: 1 };
    }
    const out = this.renderer.render(source, crop, slot.time, 640);
    if (token === this.previewToken) { ctx.clearRect(0, 0, 640, 640); ctx.drawImage(out, 0, 0); }
    release(out);
  }

  private async export(mode: 'share' | 'zip') {
    if (this.busy) return;
    const png = this.format.value === 'png';
    const requested = Number(this.size.value);
    this.setBusy(true);
    const items: NamedBlob[] = [];
    try {
      for (const [i, s] of this.slots.entries()) {
        this.status.textContent = `스탬프 찍는 중… ${i + 1} / ${this.slots.length}`;
        const img = await loadFileImage(s.photo!.file);
        const crop = centerCrop(img.naturalWidth, img.naturalHeight);
        const size = Math.min(requested || crop.s, MAX_CANVAS);
        const out = this.renderer.render(img, crop, s.time, size);
        items.push({ name: exportName(i, s.time, png), blob: await canvasToBlob(out, png) });
        release(out);
      }
      if (mode === 'share') {
        this.status.textContent = '공유 시트에서 "이미지 저장"을 누르세요.';
        const files = items.map((x) => new File([x.blob], x.name, { type: x.blob.type }));
        if (!canShareFiles(files)) throw new Error('이 브라우저는 사진 공유를 지원하지 않습니다. ZIP 다운로드를 이용해 주세요.');
        // The share sheet needs a fresh tap after this much async work on iOS.
        this.setBusy(false);
        toast(`사진 ${items.length}장이 준비되었습니다.`, { label: '저장', run: () => void shareFiles(items).catch((e) => toast(errorMessage(e))) });
        this.status.textContent = '';
        return;
      }
      this.status.textContent = 'ZIP 만드는 중…';
      download(await makeZip(items), `timestamp_${exportName(0, this.slots[0].time, false).slice(4, 17)}.zip`);
      this.status.textContent = `사진 ${items.length}장을 ZIP으로 저장했습니다.`;
    } catch (e) {
      this.status.textContent = errorMessage(e);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(v: boolean) {
    this.busy = v;
    this.el.classList.toggle('busy', v);
    const empty = this.slots.some((s) => !s.photo) || !this.slots.length;
    for (const b of [this.shareBtn, this.zipBtn]) b.disabled = v || empty;
  }
}
