// 사진 선택 → 시간별 배치 → 결과 확인·저장. State survives every screen transition.
import { arrange, assignMany, exportName, stampDate, stampTime, type Wall } from '../core/patrol';
import { clear, errorMessage, focusHeading, h, loadFileImage, toast } from '../dom';
import { canShareFiles, download, shareFiles, type NamedBlob } from '../stamp/export';
import { canvasToBlob, centerCrop, makeCanvas, release, type StampRenderer } from '../stamp/renderer';
import { planFrom, type PlanInputs } from './planform';

interface Photo { id: number; file: File; key: string; thumb: string }
interface Slot { time: Wall; photo: Photo | null }
export type BatchStep = 'photos' | 'placement' | 'results';
const STEPS: BatchStep[] = ['photos', 'placement', 'results'];
const TITLES = { photos: '사진 선택', placement: '시간별 배치', results: '결과 확인·저장' };
let nextId = 1;

export class BatchPage {
  readonly el: HTMLElement;
  private step: BatchStep = 'photos';
  private photos: Photo[] = [];
  private slots: Slot[] = [];
  private chosen = new Set<number>();
  private included = new Set<number>();
  private selectedPhotos = new Set<number>();
  private selectedSlots = new Set<number>();
  private busy = false;
  private prepared: NamedBlob[] = [];
  private viewer?: HTMLDialogElement;
  private fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  private cropOther = h('input', { type: 'checkbox' });
  private photoStrip = h('div', { class: 'photo-grid' });
  private placementStrip = h('div', { class: 'strip' });
  private photoCount = h('p', { class: 'muted', 'aria-live': 'polite' });
  private selectionCount = h('p', { class: 'muted', 'aria-live': 'polite' });
  private slotList = h('ol', { class: 'slot-list' });
  private slotCount = h('p', { class: 'muted' });
  private resultList = h('ol', { class: 'result-list' });
  private heading = h('h1');
  private progress = h('p', { class: 'eyebrow' });
  private planSummary = h('p');
  private status = h('p', { class: 'status', role: 'status' });
  private size = h('select', null, ['3240', '1080', '1536', '0'].map((v) => h('option', { value: v, selected: v === '3240' }, v === '0' ? '원본 크기 (최대 4096)' : `${v} × ${v}${v === '3240' ? ' (원본과 동일)' : ''}`)));
  private format = h('select', null, h('option', { value: 'jpg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'));
  private prepareBtn = h('button', { class: 'primary block', onclick: () => void this.prepare() }, '사진 준비');
  private saveBtn = h('button', { class: 'primary block', hidden: true, onclick: () => void this.share() }, '저장');
  private nextBtn = h('button', { class: 'primary', onclick: () => this.next() }, '다음');
  private resetBtn = h('button', { class: 'ghost danger', onclick: () => this.reset() }, '초기화');
  private panes: Record<BatchStep, HTMLFieldSetElement>;
  private footer: HTMLFieldSetElement;

  constructor(inputs: PlanInputs, private renderer: StampRenderer, private goCalc: () => void,
    private navigated: (step: BatchStep) => void = () => {}) {
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])]; this.fileInput.value = '';
      void this.addFiles(files);
    });
    this.panes = {
      photos: h('fieldset', { class: 'step-pane', 'data-step': 'photos' },
        h('div', { class: 'card' },
          h('div', { class: 'row2' }, h('button', { class: 'primary', onclick: () => this.fileInput.click() }, '사진 불러오기'),
            h('button', { class: 'ghost', onclick: () => this.removePhotos() }, '선택 사진 제외')),
          h('label', { class: 'check' }, this.cropOther, h('span', null, '1:1이 아닌 사진은 가운데를 잘라 사용')),
          h('p', { class: 'muted' }, '사진을 눌러 선택하고 다시 누르면 그 사진만 선택 해제합니다. 선택한 사진만 다음 단계에서 사용합니다.'),
          this.photoCount, this.photoStrip, this.fileInput)),
      placement: h('fieldset', { class: 'step-pane', 'data-step': 'placement', hidden: true },
        h('div', { class: 'card' }, h('h2', null, '사진과 시간 선택'), this.selectionCount, this.placementStrip,
          h('p', { class: 'muted' }, '사진과 시간을 같은 수로 선택하면 목록 순서대로 배치합니다. 1장·1개는 기존 사진과 교환합니다.'),
          h('div', { class: 'row2' },
            h('button', { class: 'secondary', onclick: () => this.assignSelected() }, '선택 시간에 배치'),
            h('button', { class: 'ghost', onclick: () => this.clearSlots() }, '선택 시간 비우기')),
          this.slotCount, this.slotList),
        h('div', { class: 'card' }, h('h2', null, '전체 자동 배치'),
          h('p', { class: 'muted' }, '1단계에서 고른 사진 전체를 모든 계획 시간에 배치합니다. 현재 선택 표시와 관계없이 기존 배치를 바꿉니다.'),
          h('div', { class: 'row2' }, h('button', { class: 'secondary', onclick: () => this.arrange(false) }, '순서대로'),
            h('button', { class: 'secondary', onclick: () => this.arrange(true) }, '랜덤 배치')))),
      results: h('fieldset', { class: 'step-pane', 'data-step': 'results', hidden: true },
        h('div', { class: 'card' }, h('div', { class: 'row2' },
          h('label', { class: 'field' }, h('span', null, '해상도'), this.size),
          h('label', { class: 'field' }, h('span', null, '형식'), this.format)),
          this.prepareBtn, this.saveBtn,
          h('p', { class: 'muted' }, '사진 준비 후 저장을 누르면 공유 시트가 열립니다. 사진별 이미지 다운로드도 사용할 수 있습니다.')),
        this.resultList),
    };
    this.footer = h('fieldset', { class: 'step-footer' },
      h('button', { class: 'secondary', onclick: () => this.back() }, '이전'), this.resetBtn, this.nextBtn);
    this.el = h('section', { class: 'page', 'data-page': 'batch' },
      h('header', { class: 'page-head' }, this.progress, this.heading, this.planSummary),
      ...Object.values(this.panes), this.status,
      h('nav', { class: 'step-actions', 'aria-label': '단계 이동' }, this.footer));
    for (const select of [this.size, this.format]) select.addEventListener('change', () => { this.invalidate(); this.renderResults(); });
    this.setInputs(inputs);
  }

  get isBusy() { return this.busy; }
  get currentStep() { return this.step; }

  setInputs(inputs: PlanInputs) {
    const times = planFrom(inputs).slots;
    if (times.map(Number).join() !== this.slots.map((s) => Number(s.time)).join()) {
      const kept = new Map(this.slots.map((s) => [Number(s.time), s.photo]));
      this.slots = times.map((time) => ({ time, photo: kept.get(Number(time)) ?? null }));
      this.selectedSlots.clear(); this.invalidate();
    }
    const first = times[0], last = times[times.length - 1];
    this.planSummary.textContent = `${stampDate(first)} · ${stampTime(first)}${times.length > 1 ? ` → ${stampDate(last)} ${stampTime(last)}` : ''} · ${times.length}개 시간`;
    this.showStep('photos', false);
  }

  showStep(step: BatchStep, notify = true) {
    if (this.busy) return;
    // A history entry can outlive a reset or a changed plan.
    if (step !== 'photos' && !this.workPhotos().length) step = 'photos';
    if (step === 'results' && this.slots.some((s) => !s.photo)) step = 'placement';
    this.step = step;
    for (const [name, pane] of Object.entries(this.panes)) pane.hidden = name !== step;
    this.heading.textContent = TITLES[step];
    this.progress.textContent = `스탬프 · ${STEPS.indexOf(step) + 1} / 3단계`;
    this.nextBtn.hidden = step === 'results'; this.resetBtn.hidden = step === 'results';
    this.status.textContent = '';
    this.refresh();
    if (notify) this.navigated(step);
    focusHeading(this.el);
  }

  private next() {
    if (this.busy) return;
    if (this.step === 'photos') {
      if (!this.chosen.size) return toast('다음 단계에서 사용할 사진을 선택해 주세요.');
      const changed = [...this.included].sort().join() !== [...this.chosen].sort().join();
      this.included = new Set(this.chosen);
      if (changed) {
        for (const s of this.slots) if (s.photo && !this.included.has(s.photo.id)) s.photo = null;
        this.selectedPhotos.clear(); this.selectedSlots.clear(); this.invalidate();
      }
      this.showStep('placement');
    } else if (this.step === 'placement') {
      const missing = this.slots.flatMap((s, i) => s.photo ? [] : [`${i + 1}번 ${stampTime(s.time)}`]);
      if (missing.length) return toast(`빈 시간 ${missing.length}개: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`);
      this.showStep('results');
    }
  }

  back() {
    if (this.busy) return;
    if (this.step === 'photos') this.goCalc();
    else this.showStep(this.step === 'results' ? 'placement' : 'photos');
  }

  private workPhotos() { return this.photos.filter((p) => this.included.has(p.id)); }
  private toggle(set: Set<number>, id: number) { if (set.has(id)) set.delete(id); else set.add(id); this.refresh(); }

  private async addFiles(files: File[]) {
    if (!files.length || this.busy) return;
    this.setBusy(true);
    const skipped: string[] = [];
    let added = 0;
    try {
      for (const [i, file] of files.entries()) {
        this.status.textContent = `사진 불러오는 중… ${i + 1} / ${files.length}`;
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        if (this.photos.some((p) => p.key === key)) continue;
        try {
          const img = await loadFileImage(file);
          const w = img.naturalWidth, height = img.naturalHeight;
          if (w !== height && !this.cropOther.checked) throw new Error(`1:1 사진만 입력할 수 있습니다. (${w} × ${height})`);
          if (w < 1 || height < 1 || w > 12000 || height > 12000) throw new Error('사진 크기는 한 변 1~12,000픽셀까지 지원합니다.');
          const c = centerCrop(w, height), thumb = makeCanvas(160, 160);
          try {
            thumb.getContext('2d')!.drawImage(img, c.sx, c.sy, c.s, c.s, 0, 0, 160, 160);
            const photo = { id: nextId++, file, key, thumb: URL.createObjectURL(await canvasToBlob(thumb, false)) };
            this.photos.push(photo); this.chosen.add(photo.id); added++;
          } finally { release(thumb); }
        } catch (e) { skipped.push(`${file.name}: ${errorMessage(e)}`); }
      }
    } finally { this.setBusy(false); }
    this.status.textContent = `사진 ${added}장 추가${skipped.length ? ` · ${skipped.length}개 파일 건너뜀` : ''}`;
    if (skipped.length) alert(`${skipped.length}개 파일을 건너뛰었습니다.\n\n${skipped.join('\n')}`);
    this.refresh();
  }

  private removePhotos() {
    if (this.busy) return;
    if (!this.chosen.size) return toast('제외할 사진을 먼저 선택해 주세요.');
    for (const p of this.photos) if (this.chosen.has(p.id)) { URL.revokeObjectURL(p.thumb); this.included.delete(p.id); this.selectedPhotos.delete(p.id); }
    this.photos = this.photos.filter((p) => !this.chosen.has(p.id));
    for (const s of this.slots) if (s.photo && this.chosen.has(s.photo.id)) s.photo = null;
    this.chosen.clear(); this.invalidate(); this.refresh();
  }

  private arrange(random: boolean) {
    if (this.busy) return;
    const photos = this.workPhotos();
    const placement = arrange(this.slots.length, photos.length, random);
    placement.forEach((p, i) => { this.slots[i].photo = p === null ? null : photos[p]; });
    this.changed(`사진 ${Math.min(this.slots.length, photos.length)}장을 배치했습니다.`);
  }

  private assignSelected() {
    if (this.busy) return;
    try {
      const photos = this.workPhotos().filter((p) => this.selectedPhotos.has(p.id));
      const targets = [...this.selectedSlots].sort((a, b) => a - b);
      const result = assignMany(this.slots.map((s) => s.photo), targets, photos);
      result.forEach((photo, i) => { this.slots[i].photo = photo; });
      this.changed(`사진 ${photos.length}장을 배치했습니다.`);
    } catch (e) { toast(errorMessage(e)); }
  }

  private clearSlots() {
    if (this.busy) return;
    if (!this.selectedSlots.size) return toast('비울 시간을 선택해 주세요.');
    const count = this.selectedSlots.size;
    for (const i of this.selectedSlots) this.slots[i].photo = null;
    this.changed(`선택한 시간 ${count}개를 비웠습니다.`);
  }

  private changed(message: string) {
    this.selectedPhotos.clear(); this.selectedSlots.clear(); this.invalidate(); this.refresh(); toast(message);
  }

  private reset() {
    if (this.busy || !confirm('불러온 사진과 배치를 모두 초기화할까요?\n날짜·시간 계획과 원본 기기 사진, 순찰 보관함은 유지됩니다.')) return;
    for (const p of this.photos) URL.revokeObjectURL(p.thumb);
    this.photos = []; this.chosen.clear(); this.included.clear(); this.selectedPhotos.clear(); this.selectedSlots.clear();
    this.slots.forEach((s) => { s.photo = null; }); this.fileInput.value = '';
    this.viewer?.close(); this.viewer?.remove(); this.viewer = undefined;
    this.invalidate(); this.showStep('photos'); toast('사진과 배치를 초기화했습니다.');
  }

  private invalidate() { this.prepared = []; this.saveBtn.hidden = true; this.status.textContent = ''; }

  private refresh() {
    const placed = new Set(this.slots.flatMap((s) => s.photo ? [s.photo.id] : []));
    this.photoCount.textContent = `불러온 사진 ${this.photos.length}장 · 선택 ${this.chosen.size}장`;
    const tiles = (photos: Photo[], selection: Set<number>) => photos.map((p) => h('div', { class: 'photo-item' },
      h('button', { class: `thumb${selection.has(p.id) ? ' selected' : ''}${placed.has(p.id) ? ' placed' : ''}`,
        'aria-label': p.file.name, 'aria-pressed': String(selection.has(p.id)), onclick: () => this.toggle(selection, p.id) },
        h('img', { src: p.thumb, alt: '' }), h('span', { class: 'selection-mark', 'aria-hidden': 'true' }, selection.has(p.id) ? '선택' : '')),
      h('button', { class: 'preview-button', 'aria-label': `${p.file.name} 미리보기`, onclick: () => void this.openPreview(p) }, '미리보기')));
    clear(this.photoStrip, this.photos.length ? tiles(this.photos, this.chosen) : h('p', { class: 'empty' }, '사진을 불러와 작업할 사진을 선택해 주세요.'));
    clear(this.placementStrip, tiles(this.workPhotos(), this.selectedPhotos));
    this.selectionCount.textContent = `선택 사진 ${this.selectedPhotos.size}장 / 선택 시간 ${this.selectedSlots.size}개`;
    const empty = this.slots.filter((s) => !s.photo).length;
    this.slotCount.textContent = `${this.slots.length}개 시간 · ${empty ? `빈 시간 ${empty}개` : '모두 배치됨'}`;
    clear(this.slotList, this.slots.map((s, i) => h('li', { class: 'slot-row' }, h('button', {
      class: `slot${this.selectedSlots.has(i) ? ' selected' : ''}${s.photo ? ' placed' : ' empty'}`,
      'aria-pressed': String(this.selectedSlots.has(i)), onclick: () => this.toggle(this.selectedSlots, i),
    }, h('span', { class: 'idx' }, String(i + 1).padStart(3, '0')),
    s.photo ? h('img', { src: s.photo.thumb, alt: '' }) : h('span', { class: 'hole' }),
    h('span', { class: 'when' }, h('b', null, stampTime(s.time)), h('small', null, stampDate(s.time)),
      h('small', null, `${this.selectedSlots.has(i) ? '선택됨 · ' : ''}${s.photo ? `배치됨 · ${s.photo.file.name}` : '비어 있음'}`))),
    h('button', { class: 'preview-button', 'aria-label': `${i + 1}번 시간 미리보기`, onclick: () => void this.openPreview(s.photo, s.time) }, '미리보기'))));
    if (this.step === 'results') this.renderResults();
  }

  private renderResults() {
    clear(this.resultList, this.slots.map((s, i) => h('li', { class: 'card result-item' },
      h('p', null, `${i + 1}. ${stampDate(s.time)} ${stampTime(s.time)}`),
      h('div', { class: 'row2' }, h('button', { class: 'secondary', onclick: () => void this.openPreview(s.photo, s.time) }, '스탬프 미리보기'),
        this.prepared[i] && h('button', { class: 'secondary', onclick: () => { const item = this.prepared[i]; download(item.blob, item.name); } }, '이미지 다운로드')))));
  }

  private async openPreview(photo: Photo | null, time?: Wall) {
    if (this.busy) return;
    this.viewer?.close(); this.viewer?.remove();
    const canvas = makeCanvas(640, 640); canvas.className = 'preview';
    const close = () => { dlg.close(); dlg.remove(); release(canvas); if (this.viewer === dlg) this.viewer = undefined; };
    const dlg = h('dialog', { class: 'viewer', 'aria-label': '사진 미리보기' }, canvas,
      h('p', null, time ? `${stampDate(time)} ${stampTime(time)}` : photo?.file.name ?? ''),
      h('button', { class: 'ghost block', onclick: close }, '닫기'));
    this.viewer = dlg; document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    try {
      const image = photo ? await loadFileImage(photo.file) : makeCanvas(1, 1);
      if (!dlg.isConnected) return;
      const crop = image instanceof HTMLImageElement ? centerCrop(image.naturalWidth, image.naturalHeight) : { sx: 0, sy: 0, s: 1 };
      if (time) {
        const out = this.renderer.render(image, crop, time, 640);
        canvas.getContext('2d')!.drawImage(out, 0, 0); release(out);
      } else canvas.getContext('2d')!.drawImage(image, crop.sx, crop.sy, crop.s, crop.s, 0, 0, 640, 640);
      if (image instanceof HTMLCanvasElement) release(image);
    } catch (e) { close(); toast(errorMessage(e)); }
  }

  private async prepare() {
    if (this.busy || this.slots.some((s) => !s.photo)) return;
    this.invalidate(); this.setBusy(true);
    const png = this.format.value === 'png', requested = Number(this.size.value);
    const items: NamedBlob[] = [];
    try {
      for (const [i, s] of this.slots.entries()) {
        this.status.textContent = `스탬프 찍는 중… ${i + 1} / ${this.slots.length}`;
        const img = await loadFileImage(s.photo!.file), crop = centerCrop(img.naturalWidth, img.naturalHeight);
        const out = this.renderer.render(img, crop, s.time, Math.min(requested || crop.s, 4096));
        try { items.push({ name: exportName(i, s.time, png), blob: await canvasToBlob(out, png) }); }
        finally { release(out); }
      }
      this.prepared = items;
      const supported = canShareFiles(items.map((i) => new File([i.blob], i.name, { type: i.blob.type })));
      this.saveBtn.hidden = !supported;
      this.status.textContent = `사진 ${items.length}장 준비됨. ${supported ? '저장을 누르거나 사진별로 다운로드하세요.' : '이 브라우저는 사진 공유를 지원하지 않습니다. 사진별 이미지 다운로드를 이용하세요.'}`;
      this.renderResults();
    } catch (e) { this.status.textContent = errorMessage(e); }
    finally { this.setBusy(false); }
  }

  private async share() {
    if (this.busy || !this.prepared.length) return;
    this.setBusy(true);
    try { this.status.textContent = await shareFiles(this.prepared) ? '사진 공유를 마쳤습니다.' : '공유를 취소했습니다. 사진은 준비된 상태로 유지됩니다.'; }
    catch (e) { this.status.textContent = errorMessage(e); }
    finally { this.setBusy(false); }
  }

  private setBusy(value: boolean) {
    this.busy = value; this.el.classList.toggle('busy', value); this.el.setAttribute('aria-busy', String(value));
    for (const pane of Object.values(this.panes)) pane.disabled = value;
    this.footer.disabled = value;
  }
}
