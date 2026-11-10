// 순찰 촬영: a camera that stamps the real Korean time of each shot, and shows which
// 5-minute patrol times are confirmed, due now, or missed.
import { exportFileName, floorMinute, koreaNow, matchSlot, SLOT_WINDOW_MS, stampDate, stampTime, type PatrolPlan, type Wall } from '../core/patrol';
import { clear, errorMessage, h, toast } from '../dom';
import { onLabelChange, labelField } from '../settings';
import { clearPatrol, deleteShot, loadSession, loadShots, persist, saveSession, saveShot, type PatrolSession, type Shot } from '../store/db';
import { download, makeZip, shareFiles, type NamedBlob } from '../stamp/export';
import { canvasToBlob, centerCrop, makeCanvas, release, type StampRenderer } from '../stamp/renderer';
import { PlanForm, planFrom, type PlanInputs } from './planform';

type View = 'setup' | 'camera' | 'gallery';
const MAX_CAMERA = 4096;

function seconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
}

const clock = (t: Wall) => `${stampTime(t)}:${String(t.getUTCSeconds()).padStart(2, '0')}`;

export class PatrolPage {
  readonly el: HTMLElement;
  private view: View = 'setup';
  private session?: PatrolSession;
  private plan?: PatrolPlan;
  private shots: Shot[] = [];
  private urls = new Map<number, string>();

  // setup
  private form: PlanForm;
  private size = h('select', null,
    h('option', { value: '1080', selected: true }, '1080 × 1080'),
    h('option', { value: '1536' }, '1536 × 1536'),
    h('option', { value: '0' }, '카메라 최대'));
  private autoShare = h('input', { type: 'checkbox' });
  private setupInfo = h('div', { class: 'card', hidden: true });
  private setupEl: HTMLElement;

  // camera
  private video = h('video', { playsinline: true, muted: true, autoplay: true }) as HTMLVideoElement;
  private overlay = h('canvas', { class: 'overlay' });
  private flash = h('div', { class: 'flash' });
  private camProgress = h('b');
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
  private ticker?: number;

  // gallery
  private galleryEl = h('div');

  constructor(inputs: PlanInputs, private renderer: StampRenderer, goCalc: () => void) {
    this.form = new PlanForm(inputs, () => this.showSetupInfo());
    this.setupEl = h('div', null,
      h('header', { class: 'page-head' }, h('h1', null, '순찰 촬영'),
        h('p', null, '찍는 순간의 실제 시각이 사진에 찍힙니다. 순찰 시간을 정해 두면 5분마다 다음 순찰 시각을 알려 주고, 확인된 시각과 빠진 시각을 보여 줍니다.')),
      this.setupInfo,
      h('div', { class: 'card' }, this.form.el,
        h('button', { class: 'ghost block', onclick: goCalc }, '계산기에서 확인하기')),
      h('div', { class: 'card' },
        labelField(),
        h('label', { class: 'field' }, h('span', null, '저장 해상도'), this.size),
        h('label', { class: 'check' }, this.autoShare, h('span', null, '찍을 때마다 바로 저장 (공유 시트 열기)')),
        h('button', { class: 'primary block big-btn', onclick: () => void this.startNew() }, '순찰 시작')),
    );
    for (const f of [this.form.date, this.form.start, this.form.end]) f.addEventListener('change', () => this.showSetupInfo());

    const viewport = h('div', { class: 'viewport' }, this.video, this.overlay, this.flash, this.camMsg);
    this.cameraEl = h('div', { class: 'camera', hidden: true },
      h('div', { class: 'cam-top' },
        h('button', { class: 'cam-btn', onclick: () => this.show('gallery') }, '보관함'),
        h('div', { class: 'cam-title' }, this.camProgress, this.camStatus)),
      viewport,
      this.camStrip,
      h('div', { class: 'cam-controls' }, this.lastThumb, this.shutter, h('span')),
    );
    new ResizeObserver(() => this.sizeOverlay()).observe(viewport);
    onLabelChange(() => { this.overlayKey = ''; });

    this.el = h('section', { class: 'page' }, this.setupEl, this.galleryEl);
    document.body.append(this.cameraEl);
    document.addEventListener('visibilitychange', () => {
      if (this.view !== 'camera') return;
      if (document.hidden) this.stopCamera();
      else void this.startCamera();
    });
    void this.restore();
  }

  setInputs(inputs: PlanInputs) {
    this.form.set(inputs);
    if (this.view !== 'camera') this.show('setup');
  }

  /** Leaving the tab (bottom nav) must release the camera. */
  hidden() {
    if (this.view === 'camera') this.show(this.session ? 'gallery' : 'setup');
  }

  private async restore() {
    try {
      const [session, shots] = await Promise.all([loadSession(), loadShots()]);
      if (session) {
        this.session = session;
        this.plan = planFrom(session);
        this.shots = shots.sort((a, b) => a.time - b.time);
        this.form.set(session);
        this.size.value = String(session.size);
        this.autoShare.checked = session.autoShare;
        if (shots.length) return this.show('gallery');
      }
    } catch (e) {
      toast('저장된 순찰을 불러오지 못했습니다: ' + errorMessage(e));
    }
    this.showSetupInfo();
  }

  /** Slot index → the photos that confirm it. */
  private confirmed(): Map<number, Shot[]> {
    const map = new Map<number, Shot[]>();
    if (!this.plan) return map;
    for (const s of this.shots) {
      const i = matchSlot(this.plan, new Date(s.time));
      if (i >= 0) map.set(i, [...(map.get(i) ?? []), s]);
    }
    return map;
  }

  /** Slots whose window has fully passed without a photo. */
  private missed(now: Wall): number[] {
    if (!this.plan) return [];
    const ok = this.confirmed();
    return this.plan.slots.flatMap((t, i) => (!ok.has(i) && now.getTime() > t.getTime() + SLOT_WINDOW_MS ? [i] : []));
  }

  private showSetupInfo() {
    const box = this.setupInfo;
    if (this.session && this.plan) {
      clear(box, h('h2', null, '진행 중인 순찰'),
        h('p', null, `${stampDate(this.plan.slots[0])} ${this.session.start}~${this.session.end}`),
        h('p', { class: 'big' }, h('strong', null, String(this.confirmed().size)), ` / ${this.plan.count}개 시각 확인 · 사진 ${this.shots.length}장`),
        h('div', { class: 'row2' },
          h('button', { class: 'primary', onclick: () => void this.resume() }, '이어서 촬영'),
          h('button', { class: 'secondary', onclick: () => this.show('gallery') }, '보관함')),
        h('p', { class: 'muted' }, '아래에서 새 순찰을 시작하면 이 순찰의 사진은 삭제됩니다. 먼저 저장해 주세요.'));
      box.hidden = false;
      return;
    }
    try {
      const plan = this.form.plan();
      clear(box, h('p', null, h('strong', null, `${plan.count}개 순찰 시각`), ` · 첫 ${stampTime(plan.slots[0])} · 마지막 ${stampTime(plan.slots[plan.count - 1])}`),
        h('p', { class: 'muted' }, '각 순찰 시각 앞뒤 2분 30초 안에 찍은 사진이 그 시각의 확인 사진이 됩니다.'),
        plan.outsideNormalHours && h('p', { class: 'warn' }, '20:00~다음 날 01:00 밖의 시간이 포함되어 있습니다.'));
      box.classList.remove('error');
    } catch (e) {
      clear(box, h('p', null, errorMessage(e)));
      box.classList.add('error');
    }
    box.hidden = false;
  }

  private async startNew() {
    let plan: PatrolPlan;
    try { plan = this.form.plan(); } catch (e) { return toast(errorMessage(e)); }
    if (this.shots.length && !confirm(`진행 중인 순찰의 사진 ${this.shots.length}장이 삭제됩니다. 새 순찰을 시작할까요?`)) return;
    await clearPatrol();
    this.revokeAll();
    this.shots = [];
    this.plan = plan;
    this.session = { ...this.form.get(), size: Number(this.size.value), autoShare: this.autoShare.checked };
    await saveSession(this.session);
    persist();
    this.show('camera');
  }

  private async resume() {
    if (!this.session) return;
    this.session.size = Number(this.size.value);
    this.session.autoShare = this.autoShare.checked;
    await saveSession(this.session);
    this.show('camera');
  }

  private show(view: View) {
    this.view = view;
    this.setupEl.hidden = view !== 'setup';
    this.galleryEl.hidden = view !== 'gallery';
    this.cameraEl.hidden = view !== 'camera';
    document.body.classList.toggle('camera-open', view === 'camera');
    clearInterval(this.ticker);
    if (view === 'camera') {
      void this.startCamera();
      this.overlayKey = '';
      this.stripKey = '';
      this.tick();
      this.ticker = window.setInterval(() => this.tick(), 1000);
    } else this.stopCamera();
    if (view === 'gallery') this.renderGallery();
    if (view === 'setup') this.showSetupInfo();
  }

  // ───────── camera ─────────

  private async startCamera() {
    this.camMsg.hidden = true;
    if (this.stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return this.cameraError('카메라는 HTTPS 주소에서만 사용할 수 있습니다.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      if (this.view !== 'camera') return this.stopCamera();
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      this.cameraError(name === 'NotAllowedError'
        ? '카메라 권한이 거부되었습니다. 주소창의 "aA" → 웹 사이트 설정 → 카메라를 "허용"으로 바꾼 뒤 다시 시도해 주세요.'
        : name === 'NotFoundError' ? '사용할 수 있는 카메라가 없습니다.' : '카메라를 켤 수 없습니다: ' + errorMessage(e));
    }
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  }

  private cameraError(message: string) {
    clear(this.camMsg, h('p', null, message), h('button', { class: 'primary', onclick: () => void this.startCamera() }, '다시 시도'));
    this.camMsg.hidden = false;
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
  }

  private sizeOverlay() {
    const css = this.overlay.getBoundingClientRect().width;
    const px = Math.min(1620, Math.round(css * Math.min(window.devicePixelRatio || 1, 3)));
    if (!px || this.overlay.width === px) return;
    this.overlay.width = this.overlay.height = px;
    this.overlayKey = '';
    if (this.view === 'camera') this.tick();
  }

  /** Once a second: live stamp preview, countdown to the next patrol time, slot strip. */
  private tick() {
    if (!this.plan) return;
    const now = koreaNow();
    const minute = floorMinute(now);
    const key = `${minute.getTime()}|${this.overlay.width}|${this.renderer.label}`;
    if (this.overlay.width && key !== this.overlayKey) {
      this.renderer.renderOverlay(this.overlay, minute);
      this.overlayKey = key;
    }
    const ok = this.confirmed();
    const plan = this.plan;
    this.camProgress.textContent = `확인 ${ok.size} / ${plan.count}`;
    const t0 = plan.slots[0].getTime(), last = plan.slots[plan.count - 1].getTime();
    const n = now.getTime();
    const slot = matchSlot(plan, now);
    let status: string;
    if (n < t0 - SLOT_WINDOW_MS) status = `순찰 시작 전 · 첫 순찰 시각 ${stampTime(plan.slots[0])}까지 ${seconds(t0 - n)}`;
    else if (n > last + SLOT_WINDOW_MS) status = `순찰 시간이 끝났습니다 · 빠진 시각 ${this.missed(now).length}개`;
    else if (slot >= 0 && !ok.has(slot)) status = `지금 촬영하세요 · ${stampTime(plan.slots[slot])} 순찰 시각`;
    else {
      const next = plan.slots.findIndex((t) => t.getTime() > n);
      status = next >= 0
        ? `${stampTime(plan.slots[slot])} 확인됨 · 다음 ${stampTime(plan.slots[next])}까지 ${seconds(plan.slots[next].getTime() - n)}`
        : `${stampTime(plan.slots[slot])} 확인됨 · 마지막 순찰 시각입니다`;
    }
    this.camStatus.textContent = status;
    this.renderStrip(ok, now, slot);
  }

  private stripKey = '';
  private renderStrip(ok: Map<number, Shot[]>, now: Wall, current: number) {
    const plan = this.plan!;
    const state = plan.slots.map((t, i) => (ok.has(i) ? 'taken' : i === current ? 'current' : now.getTime() > t.getTime() + SLOT_WINDOW_MS ? 'missed' : 'upcoming'));
    const key = state.join() + '|' + this.shots.length;
    if (key === this.stripKey) return;
    this.stripKey = key;
    clear(this.camStrip, plan.slots.map((t, i) => {
      const shots = ok.get(i);
      return h('div', { class: `cell ${state[i]}` },
        shots ? h('img', { src: this.url(shots[shots.length - 1]), alt: '' }) : h('span', { class: 'hole' }, state[i] === 'missed' ? '!' : ''),
        h('small', null, stampTime(t).replace(/^오[전후] /, '')));
    }));
    const focus = current >= 0 ? current : Math.max(0, state.indexOf('upcoming'));
    this.camStrip.children[focus]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    const latest = this.shots[this.shots.length - 1];
    clear(this.lastThumb, latest ? h('img', { src: this.url(latest), alt: '' }) : '');
  }

  private async capture() {
    if (this.capturing || !this.session || !this.stream) return;
    const v = this.video;
    if (!v.videoWidth) return toast('카메라가 준비되는 중입니다.');
    // The stamp is the real moment the button was pressed.
    const pressed = koreaNow();
    this.capturing = true;
    this.shutter.classList.add('working');
    this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
    navigator.vibrate?.(30);
    try {
      const crop = centerCrop(v.videoWidth, v.videoHeight);
      const frame = makeCanvas(crop.s, crop.s);
      frame.getContext('2d')!.drawImage(v, crop.sx, crop.sy, crop.s, crop.s, 0, 0, crop.s, crop.s);
      const size = Math.min(this.session.size || crop.s, MAX_CAMERA);
      const out = this.renderer.render(frame, { sx: 0, sy: 0, s: crop.s }, floorMinute(pressed), size);
      release(frame);
      const thumb = makeCanvas(160, 160);
      thumb.getContext('2d')!.drawImage(out, 0, 0, 160, 160);
      const [blob, thumbBlob] = await Promise.all([canvasToBlob(out, false), canvasToBlob(thumb, false)]);
      release(out); release(thumb);
      const id = Math.max(Date.now(), (this.shots[this.shots.length - 1]?.id ?? 0) + 1);
      const shot: Shot = { id, time: pressed.getTime(), blob, thumb: thumbBlob };
      await saveShot(shot);
      this.shots.push(shot);
      this.shots.sort((a, b) => a.time - b.time);
      const slot = matchSlot(this.plan!, pressed);
      toast(slot >= 0 ? `${clock(pressed)} 저장 · ${stampTime(this.plan!.slots[slot])} 확인` : `${clock(pressed)} 저장 · 순찰 시각 밖의 사진`);
      this.tick();
      if (this.session.autoShare) this.offerShare([shot]);
    } catch (e) {
      toast('저장하지 못했습니다: ' + errorMessage(e));
    } finally {
      this.capturing = false;
      this.shutter.classList.remove('working');
    }
  }

  // ───────── gallery ─────────

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
    return [...shots].sort((a, b) => a.time - b.time).map((s, i) => ({ name: exportFileName(i, new Date(s.time)), blob: s.blob }));
  }

  private offerShare(shots: Shot[]) {
    const items = this.named(shots);
    // iOS only opens the share sheet straight from a tap; after the render it may refuse,
    // so fall back to a toast button the user taps.
    shareFiles(items).catch(() =>
      toast(`${items.length}장 준비됨`, { label: '저장', run: () => void shareFiles(items).catch((e) => toast(errorMessage(e))) }));
  }

  private renderGallery() {
    if (!this.plan || !this.session) { clear(this.galleryEl); return; }
    const plan = this.plan;
    const ok = this.confirmed();
    const now = koreaNow();
    const missed = this.missed(now);
    const all = this.shots;
    const slotOf = (s: Shot) => matchSlot(plan, new Date(s.time));
    clear(this.galleryEl,
      h('header', { class: 'page-head' }, h('h1', null, '순찰 보관함'),
        h('p', null, `${stampDate(plan.slots[0])} ${this.session.start}~${this.session.end} · 확인 ${ok.size} / ${plan.count} · 사진 ${all.length}장`)),
      h('div', { class: 'card' },
        h('button', { class: 'primary block big-btn', onclick: () => void this.resume() }, '이어서 촬영'),
        h('div', { class: 'row2' },
          h('button', { class: 'secondary', disabled: !all.length, onclick: () => void shareFiles(this.named(all)).catch((e) => toast(errorMessage(e))) }, '모두 저장 (공유)'),
          h('button', { class: 'secondary', disabled: !all.length, onclick: () => void this.zipAll() }, 'ZIP 다운로드')),
        missed.length > 0 && h('p', { class: 'warn' }, `확인되지 않은 순찰 시각 ${missed.length}개: ${missed.slice(0, 8).map((i) => stampTime(plan.slots[i])).join(', ')}${missed.length > 8 ? ' …' : ''}`),
        h('button', { class: 'ghost block', onclick: () => void this.newPatrol() }, '새 순찰 시작')),
      all.length
        ? h('div', { class: 'grid' }, all.map((s) => {
          const t = new Date(s.time), i = slotOf(s);
          return h('button', { class: 'tile', onclick: () => this.openShot(s) },
            h('img', { src: this.url(s), alt: '' }),
            h('small', null, clock(t)),
            h('small', { class: i >= 0 ? 'ok' : 'off' }, i >= 0 ? `${stampTime(plan.slots[i])} 확인` : '순찰 시각 밖'));
        }))
        : h('p', { class: 'empty' }, '아직 찍은 사진이 없습니다.'),
    );
  }

  private async zipAll() {
    try {
      toast('ZIP 만드는 중…');
      const first = this.plan!.slots[0];
      download(await makeZip(this.named(this.shots)), `patrol_${exportFileName(0, first).slice(4, 17)}.zip`);
    } catch (e) { toast(errorMessage(e)); }
  }

  private async newPatrol() {
    if (this.shots.length && !confirm(`사진 ${this.shots.length}장이 이 브라우저에서 삭제됩니다. 저장하셨나요?\n새 순찰을 시작할까요?`)) return;
    await clearPatrol();
    this.revokeAll();
    this.shots = [];
    this.session = undefined; this.plan = undefined;
    this.show('setup');
  }

  private openShot(shot: Shot) {
    const url = URL.createObjectURL(shot.blob);
    const t = new Date(shot.time);
    const close = () => { dlg.close(); dlg.remove(); URL.revokeObjectURL(url); };
    const dlg = h('dialog', { class: 'viewer' },
      h('img', { src: url, alt: '' }),
      h('p', null, `${stampDate(t)} ${clock(t)} 촬영`),
      h('div', { class: 'row2' },
        h('button', { class: 'primary', onclick: () => void shareFiles(this.named([shot])).catch((e) => toast(errorMessage(e))) }, '저장'),
        h('button', { class: 'ghost danger', onclick: async () => {
          if (!confirm('이 사진을 삭제할까요?')) return;
          await deleteShot(shot.id);
          const u = this.urls.get(shot.id); if (u) URL.revokeObjectURL(u);
          this.urls.delete(shot.id);
          this.shots = this.shots.filter((s) => s !== shot);
          close(); this.renderGallery();
        } }, '삭제')),
      h('button', { class: 'ghost block', onclick: close }, '닫기'));
    document.body.append(dlg);
    dlg.showModal();
  }
}
