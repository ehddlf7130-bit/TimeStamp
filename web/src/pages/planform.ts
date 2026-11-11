// Calculator inputs; omitted mode keeps stored range sessions compatible.
import { createPlan, createSinglePlan, koreaToday, parseDate, type PatrolPlan } from '../core/patrol';
import { h } from '../dom';

export interface PlanInputs { date: string; start: string; end: string; mode?: 'range' | 'single' }

export const QUICK: { label: string; start: string; end: string }[] = [
  { label: '00:00~00:30', start: '00:00', end: '00:30' },
  { label: '00:30~01:00', start: '00:30', end: '01:00' },
  { label: '00:00~01:00', start: '00:00', end: '01:00' },
  { label: '20:00~01:00', start: '20:00', end: '01:00' },
];

export function defaultInputs(): PlanInputs {
  return { date: koreaToday(), start: '20:00', end: '01:00', mode: 'range' };
}

export class PlanForm {
  readonly el: HTMLElement;
  readonly date = h('input', { type: 'date', required: true });
  readonly start = h('input', { type: 'time', required: true });
  readonly end = h('input', { type: 'time', required: true });
  readonly mode = h('select', null, h('option', { value: 'range' }, '시간 범위'), h('option', { value: 'single' }, '단일 시각'));
  private startLabel = h('span');
  private endField = h('label', { class: 'field' }, h('span', null, '종료'), this.end);
  private quick = h('div', { class: 'chips' });

  constructor(inputs: PlanInputs, onQuick?: (q: PlanInputs) => void) {
    this.set(inputs);
    this.el = h('div', { class: 'plan-form' },
      h('label', { class: 'field' }, h('span', null, '날짜'), this.date),
      h('label', { class: 'field' }, h('span', null, '시간 지정 방식'), this.mode),
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, this.startLabel, this.start), this.endField),
      onQuick && this.quick,
    );
    if (onQuick) this.quick.append(...QUICK.map((q) => h('button', {
        type: 'button', class: 'chip',
        onclick: () => { this.start.value = q.start; this.end.value = q.end; onQuick(this.get()); },
      }, q.label)));
    this.mode.addEventListener('change', () => this.updateMode());
    this.updateMode();
  }

  get(): PlanInputs {
    // iOS may return "HH:mm:ss" if seconds were ever set; keep HH:mm.
    return { date: this.date.value, start: this.start.value.slice(0, 5), end: this.end.value.slice(0, 5), mode: this.mode.value as 'range' | 'single' };
  }

  set(v: PlanInputs) {
    this.date.value = v.date; this.start.value = v.start; this.end.value = v.end;
    this.mode.value = v.mode ?? 'range';
    this.updateMode();
  }

  private updateMode() {
    const single = this.mode.value === 'single';
    this.startLabel.textContent = single ? '시각' : '시작';
    this.endField.hidden = single;
    this.end.disabled = single;
    this.quick.hidden = single;
  }

  plan(): PatrolPlan {
    return planFrom(this.get());
  }
}

export function planFrom(v: PlanInputs): PatrolPlan {
  const date = parseDate(v.date);
  return v.mode === 'single' ? createSinglePlan(date, v.start) : createPlan(date, v.start, v.end);
}
