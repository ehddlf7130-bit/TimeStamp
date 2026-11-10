// The stamp's label text, shared by both stamping pages and remembered on this phone.
import { h } from './dom';
import { cleanLabel, DEFAULT_LABEL, MAX_LABEL } from './stamp/layout';
import type { StampRenderer } from './stamp/renderer';

const listeners = new Set<() => void>();
let renderer: StampRenderer | undefined;

export function initLabel(r: StampRenderer) {
  renderer = r;
  try { r.label = localStorage.getItem('stampLabel') ?? DEFAULT_LABEL; } catch { r.label = DEFAULT_LABEL; }
}

export function onLabelChange(fn: () => void) { listeners.add(fn); }

/** A text field bound to the shared label; every page's copy stays in sync. */
export function labelField(): HTMLElement {
  const input = h('input', { type: 'text', maxlength: MAX_LABEL, placeholder: '비우면 시계 아이콘만', value: renderer?.label ?? DEFAULT_LABEL });
  input.addEventListener('change', () => {
    if (!renderer) return;
    renderer.label = cleanLabel(input.value);
    try { localStorage.setItem('stampLabel', renderer.label); } catch { /* ignore */ }
    for (const fn of listeners) fn();
  });
  onLabelChange(() => { if (renderer && document.activeElement !== input) input.value = renderer.label; });
  return h('label', { class: 'field' }, h('span', null, '스탬프 문구 (오른쪽 위)'), input);
}
