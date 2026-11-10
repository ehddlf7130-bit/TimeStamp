import { stampDate, stampTime, type PatrolPlan } from '../core/patrol';
import { clear, errorMessage, h } from '../dom';
import { PlanForm, type PlanInputs } from './planform';

export class CalculatorPage {
  readonly el: HTMLElement;
  private form: PlanForm;
  private result = h('div', { class: 'card result', hidden: true });
  private auto = h('input', { type: 'checkbox', checked: true });
  private plan?: PatrolPlan;

  constructor(inputs: PlanInputs, private go: (page: 'batch' | 'patrol', inputs?: PlanInputs) => void) {
    this.form = new PlanForm(inputs, () => this.calculate());
    this.el = h('section', { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, '순찰 계산기'), h('p', null, '출발 5분 뒤부터 5분마다 한 장씩, 종료 시각까지 필요한 사진 수를 계산합니다.')),
      h('div', { class: 'card' }, this.form.el, h('button', { class: 'primary block', onclick: () => this.calculate() }, '계산하기')),
      this.result,
      h('div', { class: 'card' },
        h('label', { class: 'check' }, this.auto, h('span', null, '계산한 날짜와 시간을 다음 단계에 자동 입력')),
        h('div', { class: 'row2' },
          h('button', { class: 'secondary', onclick: () => this.next('batch') }, '스탬프 찍기 →'),
          h('button', { class: 'primary', onclick: () => this.next('patrol') }, '순찰 촬영 →'))),
    );
  }

  private calculate(): boolean {
    try {
      const plan = this.form.plan();
      this.plan = plan;
      const first = plan.slots[0], last = plan.slots[plan.count - 1];
      clear(this.result,
        h('div', { class: 'big' }, h('strong', null, String(plan.count)), '장'),
        h('dl', null,
          h('dt', null, '순찰 시간'), h('dd', null, `${Math.floor(plan.minutes / 60)}시간 ${plan.minutes % 60}분`),
          h('dt', null, '첫 사진'), h('dd', null, `${stampDate(first)} ${stampTime(first)}`),
          h('dt', null, '마지막 사진'), h('dd', null, `${stampDate(last)} ${stampTime(last)}`)),
        plan.outsideNormalHours && h('p', { class: 'warn' }, '20:00~다음 날 01:00 밖의 시간이 포함되어 있습니다. 입력한 시간으로 진행할 수 있습니다.'),
      );
      this.result.classList.remove('error');
    } catch (e) {
      this.plan = undefined;
      clear(this.result, h('p', null, errorMessage(e)));
      this.result.classList.add('error');
    }
    this.result.hidden = false;
    return !!this.plan;
  }

  private next(page: 'batch' | 'patrol') {
    if (!this.auto.checked) return this.go(page);
    if (this.calculate()) this.go(page, this.form.get());
  }
}
