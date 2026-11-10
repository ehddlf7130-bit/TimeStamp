// Date + start/end fields shared by all three pages.
import { createPlan, koreaToday, parseDate, type PatrolPlan } from '../core/patrol';
import { h } from '../dom';

export interface PlanInputs { date: string; start: string; end: string }

export const QUICK: { label: string; start: string; end: string }[] = [
  { label: '00:00~00:30', start: '00:00', end: '00:30' },
  { label: '00:30~01:00', start: '00:30', end: '01:00' },
  { label: '00:00~01:00', start: '00:00', end: '01:00' },
  { label: '20:00~01:00', start: '20:00', end: '01:00' },
];

export function defaultInputs(): PlanInputs {
  return { date: koreaToday(), start: '20:00', end: '01:00' };
}

export class PlanForm {
  readonly el: HTMLElement;
  readonly date = h('input', { type: 'date', required: true });
  readonly start = h('input', { type: 'time', required: true });
  readonly end = h('input', { type: 'time', required: true });

  constructor(inputs: PlanInputs, onQuick?: (q: PlanInputs) => void) {
    this.set(inputs);
    this.el = h('div', { class: 'plan-form' },
      h('label', { class: 'field' }, h('span', null, '순찰 시작 날짜'), this.date),
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, h('span', null, '시작'), this.start),
        h('label', { class: 'field' }, h('span', null, '종료'), this.end)),
      onQuick && h('div', { class: 'chips' }, QUICK.map((q) => h('button', {
        type: 'button', class: 'chip',
        onclick: () => { this.start.value = q.start; this.end.value = q.end; onQuick(this.get()); },
      }, q.label))),
    );
  }

  get(): PlanInputs {
    // iOS may return "HH:mm:ss" if seconds were ever set; keep HH:mm.
    return { date: this.date.value, start: this.start.value.slice(0, 5), end: this.end.value.slice(0, 5) };
  }

  set(v: PlanInputs) {
    this.date.value = v.date; this.start.value = v.start; this.end.value = v.end;
  }

  plan(): PatrolPlan {
    return planFrom(this.get());
  }
}

export function planFrom(v: PlanInputs): PatrolPlan {
  return createPlan(parseDate(v.date), v.start, v.end);
}
