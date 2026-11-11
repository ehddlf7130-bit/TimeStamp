import './styles.css';
import { clear, errorMessage, focusHeading, h } from './dom';
import { BatchPage, type BatchStep } from './pages/batch';
import { CalculatorPage } from './pages/calculator';
import { PatrolPage, type PatrolView } from './pages/patrol';
import { defaultInputs, type PlanInputs } from './pages/planform';
import { StampRenderer } from './stamp/renderer';

type Page = 'calc' | 'batch' | 'patrol';
interface Route { page: Page; step?: BatchStep; view?: PatrolView }
const app = document.getElementById('app')!;

async function main() {
  const renderer = await StampRenderer.load(), inputs = defaultInputs();
  const content = h('main');
  let current: Page = 'calc', restoringHistory = false;
  const record = (route: Route) => { if (!restoringHistory) history.pushState({ timestamp: route }, ''); };
  const go = (page: Page, handoff?: PlanInputs, notify = true) => {
    current = page;
    if (page !== 'patrol') patrol.hidden();
    for (const [id, screen] of Object.entries(pages)) screen.el.hidden = id !== page;
    if (handoff && page === 'batch') batch.setInputs(handoff);
    if (handoff && page === 'patrol') patrol.setInputs(handoff);
    if (page === 'calc') calc.setPatrolAvailable(patrol.hasSession);
    if (notify) record({ page, step: page === 'batch' ? batch.currentStep : undefined, view: page === 'patrol' ? patrol.currentView : undefined });
    focusHeading(pages[page].el);
  };
  const calc = new CalculatorPage(inputs, (page, handoff) => go(page, handoff), (view) => {
    go('patrol', undefined, false);
    void patrol.openSaved(view);
  });
  const batch = new BatchPage(inputs, renderer, () => go('calc'), (step) => { if (current === 'batch') record({ page: 'batch', step }); });
  const patrol = new PatrolPage(inputs, renderer, () => go('calc'), (view) => { if (current === 'patrol') record({ page: 'patrol', view }); });
  const pages = { calc, batch, patrol };
  clear(content, calc.el, batch.el, patrol.el); clear(app, content);
  go('calc', undefined, false);
  history.replaceState({ timestamp: { page: 'calc' } }, '');
  void patrol.ready.then(() => calc.setPatrolAvailable(patrol.hasSession));
  window.addEventListener('popstate', (event: PopStateEvent) => {
    if (batch.isBusy || patrol.isBusy) {
      record({ page: current, step: batch.currentStep, view: patrol.currentView });
      return;
    }
    const route = event.state?.timestamp as Route | undefined;
    if (!route || !['calc', 'batch', 'patrol'].includes(route.page)) return;
    restoringHistory = true;
    try {
      go(route.page, undefined, false);
      if (route.page === 'batch') batch.showStep(route.step ?? 'photos', false);
      if (route.page === 'patrol') patrol.showView(route.view ?? 'setup');
    } finally { restoringHistory = false; }
  });
}

main().catch((e) => {
  clear(app, h('div', { class: 'card error boot' }, h('p', null, '앱을 시작하지 못했습니다.'), h('p', null, errorMessage(e)),
    h('button', { class: 'primary', onclick: () => location.reload() }, '새로고침')));
});
