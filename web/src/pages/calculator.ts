import { DEFAULT_KM_PER_30_MIN, formatKm, patrolDistanceKm, stampDate, stampTime, type PatrolPlan } from '../core/patrol';
import { clear, errorMessage, h, toast } from '../dom';
import { PlanForm, type PlanInputs } from './planform';

export class CalculatorPage {
  readonly el: HTMLElement;
  private form: PlanForm;
  private result = h('div', { class: 'card result', hidden: true });
  private plan?: PatrolPlan;
  private task?: 'batch' | 'patrol';
  private saved = h('div', { class: 'card', hidden: true });
  private rate = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.1', value: String(DEFAULT_KM_PER_30_MIN) });
  private distance = h('output', { class: 'distance-value', 'aria-live': 'polite' });

  constructor(inputs: PlanInputs, private go: (page: 'batch' | 'patrol', inputs: PlanInputs) => void,
    resume: (view: 'camera' | 'gallery') => void) {
    this.form = new PlanForm(inputs, () => this.calculate());
    this.form.el.addEventListener('input', () => { this.plan = undefined; this.result.hidden = true; this.updateDistance(); });
    this.form.el.addEventListener('change', () => this.updateDistance());
    this.rate.addEventListener('input', () => { this.updateDistance(); if (!this.result.hidden && this.plan) this.calculate(); });
    this.result.setAttribute('aria-live', 'polite');
    this.el = h('section', { class: 'page', 'data-page': 'calc' },
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, '시작 · 시간과 작업 선택'),
        h('h1', null, '순찰 계산기'), h('p', null, '시간 범위 또는 단일 시각을 정한 뒤 작업을 선택하세요.')),
      h('div', { class: 'card' }, this.form.el,
        h('div', { class: 'distance' },
          h('label', { class: 'field' }, h('span', null, '30분당 순찰 거리(km)'), this.rate),
          h('p', { class: 'distance-result' }, h('span', null, '순찰 거리'), this.distance)),
        h('button', { class: 'primary block', onclick: () => this.calculate() }, '계산하기')),
      this.result,
      h('fieldset', { class: 'card task-choice' }, h('legend', null, '작업 선택'),
        ...([{ value: 'batch', label: '스탬프 찍기', hint: '불러온 사진에 계획 시각을 넣어요' },
          { value: 'patrol', label: '순찰 촬영', hint: '카메라로 계획 시각을 찍어요' }] as const).map((task) =>
          h('label', { class: 'task-option' }, h('input', { type: 'radio', name: 'task', value: task.value,
            onchange: () => { this.task = task.value; } }),
          h('span', null, h('b', null, task.label), h('small', null, task.hint))))),
      this.saved,
      h('nav', { class: 'step-actions', 'aria-label': '단계 이동' },
        h('button', { class: 'primary block', onclick: () => this.next() }, '다음')),
    );
    clear(this.saved, h('h2', null, '저장된 순찰'), h('p', { class: 'muted' }, '기존 계획과 사진을 그대로 이어서 사용합니다.'),
      h('div', { class: 'row2' }, h('button', { class: 'secondary', onclick: () => resume('camera') }, '이어서 촬영'),
        h('button', { class: 'secondary', onclick: () => resume('gallery') }, '보관함')));
    this.updateDistance();
  }

  /** Distance for the entered times; null when times or rate are not usable yet. */
  private distanceText(minutes: number): string | null {
    const rate = this.rate.value.trim() === '' ? NaN : Number(this.rate.value);
    try { return formatKm(patrolDistanceKm(minutes, rate)); } catch { return null; }
  }

  private updateDistance() {
    let minutes: number | null = null;
    try { minutes = this.form.get().mode === 'single' ? 0 : this.form.plan().minutes; } catch { /* incomplete times */ }
    const single = this.form.get().mode === 'single';
    const text = minutes === null ? null : this.distanceText(minutes);
    this.distance.textContent = single ? '단일 시각은 계산하지 않아요' : text ?? '—';
    this.distance.classList.toggle('muted', single || text === null);
  }

  setPatrolAvailable(available: boolean) { this.saved.hidden = !available; }

  private calculate(): boolean {
    try {
      const plan = this.form.plan();
      this.plan = plan;
      const first = plan.slots[0], last = plan.slots[plan.count - 1];
      clear(this.result,
        h('div', { class: 'big' }, h('strong', null, String(plan.count)), '장'),
        h('dl', null,
          h('dt', null, '시간 지정'), h('dd', null, this.form.get().mode === 'single' ? '단일 시각' : `${Math.floor(plan.minutes / 60)}시간 ${plan.minutes % 60}분`),
          this.form.get().mode !== 'single' && [h('dt', null, '순찰 거리'), h('dd', null, this.distanceText(plan.minutes) ?? '—')],
          h('dt', null, '첫 사진'), h('dd', null, `${stampDate(first)} ${stampTime(first)}`),
          h('dt', null, '마지막 사진'), h('dd', null, `${stampDate(last)} ${stampTime(last)}`)),
        plan.outsideNormalHours && h('p', { class: 'warn' }, '20:00~다음 날 01:00 밖의 시간이 포함되어 있습니다. 입력한 시간으로 진행할 수 있습니다.'),
      );
      this.result.classList.remove('error');
      this.updateDistance();
    } catch (e) {
      this.plan = undefined;
      clear(this.result, h('p', null, errorMessage(e)));
      this.result.classList.add('error');
    }
    this.result.hidden = false;
    return !!this.plan;
  }

  private next() {
    if (!this.calculate()) return;
    if (!this.task) return toast('스탬프 찍기 또는 순찰 촬영을 선택해 주세요.');
    this.go(this.task, this.form.get());
  }
}
