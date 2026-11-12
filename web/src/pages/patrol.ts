// 순찰 촬영: each shutter press stamps the selected planned time and advances immediately.
import { exportFileName, exportName, nextPendingSlot, stampDate, stampTime, type PatrolPlan } from '../core/patrol';
import { koreaTimestamp, withCaptureTime } from '../core/exif';
import { clear, errorMessage, focusHeading, h, toast } from '../dom';
import { deleteShot, loadSession, loadShots, persist, saveCapture, saveSession, startPatrol, type PatrolSession, type Shot } from '../store/db';
import { download, shareFiles, type NamedBlob } from '../stamp/export';
import { canvasToBlob, centerCrop, makeCanvas, release, type StampRenderer } from '../stamp/renderer';
import { PlanForm, planFrom, type PlanInputs } from './planform';

export type PatrolView = 'setup' | 'camera' | 'gallery';
const MAX_CAMERA = 4096;

export class PatrolPage {
  readonly el: HTMLElement;
  private view: PatrolView = 'setup';
  readonly ready: Promise<void>;
  private session?: PatrolSession;
  private plan?: PatrolPlan;
  private shots: Shot[] = [];
  private slot = 0;
  private restored = false;
  private urls = new Map<number, string>();

  private form: PlanForm;
  private size = h('select', null,
    h('option', { value: '3240', selected: true }, '3240 × 3240 (원본과 동일)'),
    h('option', { value: '1080' }, '1080 × 1080'),
    h('option', { value: '1536' }, '1536 × 1536'),
    h('option', { value: '0' }, '카메라 최대'));
  private autoShare = h('input', { type: 'checkbox' });
  private setupInfo = h('div', { class: 'card', hidden: true });
  private startButton = h('button', { class: 'primary block big-btn', disabled: true, onclick: () => void this.startNew() }, '순찰 시작');
  private setupEl: HTMLElement;

  private video = h('video', { playsinline: true, muted: true, autoplay: true }) as HTMLVideoElement;
  private overlay = h('canvas', { class: 'overlay' });
  private flash = h('div', { class: 'flash' });
  private camProgress = h('h1', { class: 'cam-heading', tabindex: -1 });
  private camStatus = h('span');
  private camStrip = h('div', { class: 'cam-strip' });
  private camMsg = h('div', { class: 'cam-msg', hidden: true });
  private lastThumb = h('button', { class: 'cam-last', 'aria-label': '보관함', onclick: () => this.show('gallery') });
  private shutter = h('button', { class: 'shutter', 'aria-label': '촬영', onclick: () => void this.capture() });
  private cameraEl: HTMLElement;
  private stream?: MediaStream;
  private wakeLock?: WakeLockSentinel;
  private capturing = false;
  private overlayKey = '';
  private galleryEl = h('div');

  constructor(inputs: PlanInputs, private renderer: StampRenderer, private goCalc: () => void,
    private navigated: (view: PatrolView) => void = () => {}) {
    this.form = new PlanForm(inputs);
    this.setupEl = h('div', null,
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, '순찰 · 1 / 3단계'), h('h1', null, '촬영 준비'),
        h('p', null, '계산기에서 정한 계획을 확인하고 촬영을 시작하세요.')),
      this.setupInfo,
      h('div', { class: 'card' },
        h('label', { class: 'field' }, h('span', null, '저장 해상도'), this.size),
        h('label', { class: 'check' }, this.autoShare, h('span', null, '찍을 때마다 바로 저장 (공유 시트 열기)')),
        this.startButton),
      h('nav', { class: 'step-actions', 'aria-label': '단계 이동' }, h('button', { class: 'secondary block', onclick: goCalc }, '이전')));

    const viewport = h('div', { class: 'viewport' }, this.video, this.overlay, this.flash, this.camMsg);
    this.cameraEl = h('div', { class: 'camera', hidden: true },
      h('div', { class: 'cam-top' },
        h('button', { class: 'cam-btn', onclick: () => this.show('gallery') }, '보관함'),
        h('div', { class: 'cam-title' }, this.camProgress, this.camStatus)),
      viewport, this.camStrip,
      h('div', { class: 'cam-controls' }, this.lastThumb, this.shutter, h('span')));
    new ResizeObserver(() => this.sizeOverlay()).observe(viewport);
    this.el = h('section', { class: 'page', 'data-page': 'patrol', hidden: true }, this.setupEl, this.galleryEl);
    document.body.append(this.cameraEl);
    document.addEventListener('visibilitychange', () => {
      if (this.view !== 'camera') return;
      if (document.hidden) this.stopCamera();
      else void this.startCamera();
    });
    this.ready = this.restore();
  }

  get hasSession() { return !!this.session; }
  get currentView() { return this.view; }
  get isBusy() { return this.capturing || this.startButton.disabled; }

  async openSaved(view: 'camera' | 'gallery') {
    await this.ready;
    if (!this.session || this.capturing) return;
    if (view === 'camera') await this.resume();
    else this.show('gallery');
  }

  showView(view: PatrolView) {
    if (this.capturing) return;
    this.show(view !== 'setup' && !this.session ? 'setup' : view, false);
  }

  setInputs(inputs: PlanInputs) {
    this.form.set(inputs);
    this.show('setup', false);
  }

  hidden() {
    if (this.view === 'camera') this.show(this.session ? 'gallery' : 'setup', false);
  }

  private async restore() {
    try {
      const [session, shots] = await Promise.all([loadSession(), loadShots()]);
      if (session) {
        this.plan = planFrom(session);
        // Upgrade the former low-resolution default once; retain later choices.
        this.session = { ...session, size: session.resolutionVersion ? session.size : session.size === 1080 ? 3240 : session.size, resolutionVersion: 1 };
        this.shots = await Promise.all(shots.sort((a, b) => a.time - b.time).map(async (shot) => ({
          ...shot, blob: await withCaptureTime(shot.blob, new Date(shot.time)),
        })));
        this.size.value = String(this.session.size);
        this.autoShare.checked = session.autoShare;
        this.slot = this.nextSlot();
        if (shots.length) this.show('gallery');
      }
    } catch (e) {
      toast('저장된 순찰을 불러오지 못했습니다: ' + errorMessage(e));
    } finally {
      this.restored = true;
      this.startButton.disabled = false;
      this.showSetupInfo();
    }
  }

  /** Legacy real-time photos remain in the gallery, without occupying planned slots. */
  private planned(): Map<number, Shot> {
    const map = new Map<number, Shot>();
    for (const shot of this.shots) {
      const i = shot.slotIndex;
      if (i !== undefined && this.plan?.slots[i]?.getTime() === shot.time) map.set(i, shot);
    }
    return map;
  }

  private nextSlot() {
    return nextPendingSlot(this.plan!.count, this.planned().keys(), this.session?.nextSlot);
  }

  private showSetupInfo() {
    const box = this.setupInfo;
    try {
      const plan = this.form.plan();
      clear(box, h('h2', null, '촬영할 계획'),
        h('p', null, `${stampDate(plan.slots[0])} · ${this.form.get().mode === 'single' ? `단일 시각 ${this.form.get().start}` : `${this.form.get().start}~${this.form.get().end}`}`),
        h('p', { class: 'big' }, h('strong', null, String(plan.count)), '장'),
        h('p', null, `첫 ${stampTime(plan.slots[0])} · 마지막 ${stampTime(plan.slots[plan.count - 1])}`),
        h('p', { class: 'muted' }, this.form.get().mode === 'single' ? '지정한 시각으로 한 번 촬영하면 보관함으로 이동합니다.' : '저장에 성공하면 다음 계획 시각으로 넘어갑니다. 기다리지 않고 연속으로 찍을 수 있습니다.'),
        plan.outsideNormalHours && h('p', { class: 'warn' }, '20:00~다음 날 01:00 밖의 시간이 포함되어 있습니다.'),
        this.shots.length > 0 && h('p', { class: 'warn' }, `기존 순찰 사진 ${this.shots.length}장은 새 촬영을 시작할 때 교체 여부를 확인합니다. 이전으로 돌아가기만 하면 사진은 유지됩니다.`));
      box.classList.remove('error');
    } catch (e) {
      clear(box, h('p', null, errorMessage(e)));
      box.classList.add('error');
    }
    box.hidden = false;
  }

  private async startNew() {
    if (!this.restored || this.capturing || this.startButton.disabled) return;
    let plan: PatrolPlan;
    try { plan = this.form.plan(); } catch (e) { return toast(errorMessage(e)); }
    if (this.shots.length && !confirm(`진행 중인 순찰의 사진 ${this.shots.length}장이 삭제됩니다. 새 순찰을 시작할까요?`)) return;
    this.startButton.disabled = true;
    try {
      const session: PatrolSession = { ...this.form.get(), size: Number(this.size.value), autoShare: this.autoShare.checked, nextSlot: 0, resolutionVersion: 1 };
      await startPatrol(session);
      this.revokeAll(); this.shots = [];
      this.plan = plan; this.session = session; this.slot = 0;
      persist();
      this.show('camera');
    } catch (e) { toast('순찰을 시작하지 못했습니다: ' + errorMessage(e)); }
    finally { this.startButton.disabled = false; }
  }

  private async resume() {
    if (!this.session || this.capturing) return;
    try {
      const session = { ...this.session, size: Number(this.size.value), autoShare: this.autoShare.checked };
      await saveSession(session);
      this.session = session;
      const next = this.nextSlot();
      this.slot = next < this.plan!.count ? next : 0;
      this.show('camera');
    } catch (e) { toast(errorMessage(e)); }
  }

  private show(view: PatrolView, notify = true) {
    if (view === 'camera' && this.el.hidden) return;
    this.view = view;
    this.setupEl.hidden = view !== 'setup';
    this.galleryEl.hidden = view !== 'gallery';
    this.cameraEl.hidden = view !== 'camera';
    document.body.classList.toggle('camera-open', view === 'camera');
    if (view === 'camera') {
      if (this.plan && !this.plan.slots[this.slot]) this.slot = 0;
      this.overlayKey = '';
      this.updateCamera();
      this.camProgress.focus({ preventScroll: true });
      void this.startCamera();
    } else this.stopCamera();
    if (view === 'gallery') this.renderGallery();
    if (view === 'setup') this.showSetupInfo();
    if (notify && !this.el.hidden) this.navigated(view);
    if (view !== 'camera' && !this.el.hidden) focusHeading(this.el);
  }

  private async startCamera() {
    this.camMsg.hidden = true;
    if (this.stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return this.cameraError('카메라는 HTTPS 주소에서만 사용할 수 있습니다.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      if (this.view !== 'camera' || document.hidden || this.stream) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      this.cameraError(name === 'NotAllowedError'
        ? '카메라 권한이 거부되었습니다. 브라우저의 웹 사이트 설정에서 카메라를 허용한 뒤 다시 시도해 주세요.'
        : name === 'NotFoundError' ? '사용할 수 있는 카메라가 없습니다.' : '카메라를 켤 수 없습니다: ' + errorMessage(e));
    }
  }

  private cameraError(message: string) {
    clear(this.camMsg, h('p', null, message), h('button', { class: 'primary', onclick: () => void this.startCamera() }, '다시 시도'));
    this.camMsg.hidden = false;
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined; this.video.srcObject = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
  }

  private sizeOverlay() {
    const css = this.overlay.getBoundingClientRect().width;
    const px = Math.min(1620, Math.round(css * Math.min(window.devicePixelRatio || 1, 3)));
    if (!px || this.overlay.width === px) return;
    this.overlay.width = this.overlay.height = px;
    this.overlayKey = '';
    if (this.view === 'camera') this.updateCamera();
  }

  private selectSlot(index: number) {
    if (this.capturing || !this.plan?.slots[index]) return;
    this.slot = index;
    this.updateCamera();
  }

  private updateCamera() {
    if (!this.plan) return;
    const time = this.plan.slots[this.slot];
    this.shutter.disabled = this.capturing || !time;
    const taken = this.planned();
    this.camProgress.textContent = time ? `${this.slot + 1} / ${this.plan.count} · ${stampTime(time)}` : '촬영 완료';
    this.camStatus.textContent = `${taken.has(this.slot) ? '다시 찍기 · 저장된 사진을 교체합니다' : '계획 시각으로 촬영'} · ${taken.size} / ${this.plan.count}장 저장`;
    const key = `${time?.getTime()}|${this.overlay.width}`;
    if (time && this.overlay.width && key !== this.overlayKey) {
      this.renderer.renderOverlay(this.overlay, time);
      this.overlayKey = key;
    }
    clear(this.camStrip, this.plan.slots.map((t, i) => {
      const shot = taken.get(i);
      return h('button', {
        class: `cell${shot ? ' taken' : ''}${i === this.slot ? ' current' : ''}`,
        disabled: this.capturing,
        'aria-label': `${stampTime(t)}${shot ? ' 다시 찍기' : ' 촬영'}`,
        'aria-pressed': String(i === this.slot),
        onclick: () => this.selectSlot(i),
      }, shot ? h('img', { src: this.url(shot), alt: '' }) : h('span', { class: 'hole' }),
      h('small', null, stampTime(t).replace(/^오[전후] /, '')));
    }));
    this.camStrip.children[this.slot]?.scrollIntoView({ inline: 'center', block: 'nearest' });
    const latest = [...this.shots].sort((a, b) => b.id - a.id)[0];
    clear(this.lastThumb, latest ? h('img', { src: this.url(latest), alt: '' }) : '');
  }

  private async capture() {
    if (this.capturing || !this.session || !this.stream || !this.plan) return;
    const v = this.video;
    if (!v.videoWidth) return toast('카메라가 준비되는 중입니다.');
    const slotIndex = this.slot;
    const time = this.plan.slots[slotIndex];
    if (!time) return;
    this.capturing = true;
    this.shutter.classList.add('working');
    this.updateCamera();
    this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
    navigator.vibrate?.(30);
    const canvases: HTMLCanvasElement[] = [];
    try {
      const crop = centerCrop(v.videoWidth, v.videoHeight);
      const frame = makeCanvas(crop.s, crop.s); canvases.push(frame);
      frame.getContext('2d')!.drawImage(v, crop.sx, crop.sy, crop.s, crop.s, 0, 0, crop.s, crop.s);
      const size = Math.min(this.session.size || crop.s, MAX_CAMERA);
      const out = this.renderer.render(frame, { sx: 0, sy: 0, s: crop.s }, time, size); canvases.push(out);
      release(frame);
      const thumb = makeCanvas(160, 160); canvases.push(thumb);
      thumb.getContext('2d')!.drawImage(out, 0, 0, 160, 160);
      const [blob, thumbBlob] = await Promise.all([
        canvasToBlob(out, false).then((jpeg) => withCaptureTime(jpeg, time)), canvasToBlob(thumb, false),
      ]);
      const previous = this.planned().get(slotIndex);
      const id = previous?.id ?? Math.max(Date.now(), ...this.shots.map((s) => s.id + 1));
      const shot: Shot = { id, time: time.getTime(), slotIndex, blob, thumb: thumbBlob };
      const shots = [...this.shots.filter((s) => s.id !== id), shot].sort((a, b) => a.time - b.time);
      const next = nextPendingSlot(this.plan.count, shots.flatMap((s) => s.slotIndex === undefined ? [] : [s.slotIndex]), this.session.nextSlot);
      const session = { ...this.session, nextSlot: next };
      await saveCapture(shot, session);
      const oldUrl = this.urls.get(id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      this.urls.delete(id);
      this.shots = shots; this.session = session; this.slot = next;
      toast(`${stampTime(time)} 저장${next >= this.plan.count ? ' · 모든 시각 촬영 완료' : ''}`);
      if (next >= this.plan.count) this.show('gallery');
      else if (this.view === 'gallery') this.renderGallery();
      if (this.session.autoShare) this.offerShare([shot]);
    } catch (e) {
      toast('저장하지 못했습니다: ' + errorMessage(e));
    } finally {
      canvases.forEach(release);
      this.capturing = false;
      this.shutter.classList.remove('working');
      if (this.view === 'camera') this.updateCamera();
    }
  }

  private url(shot: Shot): string {
    let u = this.urls.get(shot.id);
    if (!u) { u = URL.createObjectURL(shot.thumb); this.urls.set(shot.id, u); }
    return u;
  }

  private revokeAll() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }

  private named(shots: Shot[]): NamedBlob[] {
    return [...shots].sort((a, b) => a.time - b.time).map((s, i) => ({
      name: s.slotIndex === undefined ? exportFileName(i, new Date(s.time)) : exportName(s.slotIndex, new Date(s.time), false), blob: s.blob,
      lastModified: koreaTimestamp(new Date(s.time)),
    }));
  }

  private offerShare(shots: Shot[]) {
    const items = this.named(shots);
    shareFiles(items).catch(() => toast(`${items.length}장 준비됨`, {
      label: '저장', run: () => void shareFiles(items).catch((e) => toast(errorMessage(e))),
    }));
  }

  private async share(shots: Shot[]) {
    try { toast(await shareFiles(this.named(shots)) ? '사진 공유를 마쳤습니다.' : '공유를 취소했습니다.'); }
    catch (e) { toast(errorMessage(e)); }
  }

  private renderGallery() {
    if (!this.plan || !this.session) { clear(this.galleryEl); return; }
    const plan = this.plan;
    const taken = this.planned();
    const pending = plan.slots.filter((_, i) => !taken.has(i));
    const legacy = this.shots.filter((s) => s.slotIndex === undefined).length;
    clear(this.galleryEl,
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, '순찰 · 3 / 3단계'), h('h1', null, '순찰 보관함'),
        h('p', null, `${stampDate(plan.slots[0])} ${this.session.mode === 'single' ? this.session.start : `${this.session.start}~${this.session.end}`} · ${taken.size} / ${plan.count}장 촬영`)),
      h('div', { class: 'card' },
        h('button', { class: 'primary block big-btn', onclick: () => void this.resume() }, pending.length ? '이어서 촬영' : '사진 다시 찍기'),
        h('button', { class: 'secondary block', disabled: !this.shots.length, onclick: () => void this.share(this.shots) }, '모두 저장 (공유)'),
        h('p', { class: 'muted' }, '사진을 열면 개별 저장과 이미지 다운로드를 사용할 수 있습니다.'),
        h('p', { class: pending.length ? 'muted' : 'ok' }, pending.length
          ? `남은 시각 ${pending.length}개: ${pending.slice(0, 8).map(stampTime).join(', ')}${pending.length > 8 ? ' …' : ''}`
          : '모든 계획 시각의 사진을 촬영했습니다.'),
        legacy > 0 && h('p', { class: 'muted' }, `이전 버전에서 찍은 사진 ${legacy}장은 그대로 보관합니다. 새 촬영은 계획 시각 순서대로 진행합니다.`),
        h('button', { class: 'ghost block', onclick: () => this.newPatrol() }, '새 순찰 시작')),
      this.shots.length ? h('div', { class: 'grid' }, this.shots.map((s) => h('button', { class: 'tile', onclick: () => this.openShot(s) },
        h('img', { src: this.url(s), alt: '' }), h('small', null, stampTime(new Date(s.time))),
        h('small', null, s.slotIndex === undefined ? '이전 촬영 사진' : `${s.slotIndex + 1}번째 계획 시각`))))
        : h('p', { class: 'empty' }, '아직 찍은 사진이 없습니다.'),
      h('nav', { class: 'step-actions', 'aria-label': '단계 이동' }, h('button', { class: 'secondary block', onclick: this.goCalc }, '계산기로')));
  }

  private newPatrol() {
    if (this.capturing) return toast('사진 저장이 끝난 뒤 다시 시도해 주세요.');
    this.goCalc();
  }

  private openShot(shot: Shot) {
    const url = URL.createObjectURL(shot.blob);
    const t = new Date(shot.time);
    const close = () => { dlg.close(); dlg.remove(); URL.revokeObjectURL(url); };
    const dlg = h('dialog', { class: 'viewer' },
      h('img', { src: url, alt: '' }),
      h('p', null, `${stampDate(t)} ${stampTime(t)} · ${shot.slotIndex === undefined ? '이전 촬영 사진' : '계획 시각'}`),
      shot.slotIndex !== undefined && h('button', { class: 'secondary block', onclick: () => {
        if (this.capturing) return;
        close(); this.slot = shot.slotIndex!; this.show('camera');
      } }, '이 시각 다시 찍기'),
      h('div', { class: 'row2' },
        h('button', { class: 'primary', onclick: () => void this.share([shot]) }, '저장'),
        h('button', { class: 'ghost danger', onclick: async () => {
          if (this.capturing || !confirm('이 사진을 삭제할까요?')) return;
          try {
            await deleteShot(shot.id);
            const u = this.urls.get(shot.id); if (u) URL.revokeObjectURL(u);
            this.urls.delete(shot.id); this.shots = this.shots.filter((s) => s !== shot);
            close(); this.renderGallery();
          } catch (e) { toast(errorMessage(e)); }
        } }, '삭제')),
      h('button', { class: 'secondary block', onclick: () => { const item = this.named([shot])[0]; download(item.blob, item.name); } }, '이미지 다운로드'),
      h('button', { class: 'ghost block', onclick: close }, '닫기'));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(dlg); dlg.showModal();
  }
}
