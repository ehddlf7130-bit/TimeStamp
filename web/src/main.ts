import './styles.css';
import { clear, errorMessage, h } from './dom';
import { BatchPage } from './pages/batch';
import { CalculatorPage } from './pages/calculator';
import { PatrolPage } from './pages/patrol';
import { defaultInputs, type PlanInputs } from './pages/planform';
import { StampRenderer } from './stamp/renderer';
import { initLabel } from './settings';

type Tab = 'calc' | 'batch' | 'patrol';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calc', label: '계산기', icon: '⏱' },
  { id: 'batch', label: '스탬프 찍기', icon: '▦' },
  { id: 'patrol', label: '순찰 촬영', icon: '◉' },
];

const app = document.getElementById('app')!;

function remembered(): Tab {
  try {
    const v = localStorage.getItem('tab');
    if (v === 'calc' || v === 'batch' || v === 'patrol') return v;
  } catch { /* private mode */ }
  return 'patrol';
}

async function main() {
  const renderer = new StampRenderer();
  initLabel(renderer);
  const inputs = defaultInputs();
  const main = h('main');
  const nav = h('nav', { class: 'tabs' });
  let current: Tab = remembered();

  const go = (tab: Tab, handoff?: PlanInputs) => {
    if (current === 'patrol' && tab !== 'patrol') patrol.hidden();
    current = tab;
    try { localStorage.setItem('tab', tab); } catch { /* ignore */ }
    if (handoff && tab === 'batch') batch.setInputs(handoff);
    if (handoff && tab === 'patrol') patrol.setInputs(handoff);
    for (const [id, page] of Object.entries(pages)) page.el.hidden = id !== tab;
    for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
    window.scrollTo(0, 0);
  };

  const calc = new CalculatorPage(inputs, (page, handoff) => go(page, handoff));
  const batch = new BatchPage(inputs, renderer);
  const patrol = new PatrolPage(inputs, renderer, () => go('calc'));
  const pages: Record<Tab, { el: HTMLElement }> = { calc, batch, patrol };

  clear(nav, TABS.map((t) => h('button', { 'data-tab': t.id, onclick: () => go(t.id) }, h('span', { class: 'icon' }, t.icon), h('span', null, t.label))));
  clear(main, calc.el, batch.el, patrol.el);
  clear(app, main, nav);
  go(current);
}

main().catch((e) => {
  clear(app, h('div', { class: 'card error boot' }, h('p', null, '앱을 시작하지 못했습니다.'), h('p', null, errorMessage(e)),
    h('button', { class: 'primary', onclick: () => location.reload() }, '새로고침')));
});
