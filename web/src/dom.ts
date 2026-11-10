type Child = Node | string | number | false | null | undefined;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Tiny element builder: h('button', { class: 'x', onclick }, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== false && c !== null && c !== undefined) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function clear(el: Element, ...children: (Child | Child[])[]) {
  el.replaceChildren();
  for (const c of children.flat()) if (c !== false && c !== null && c !== undefined) el.append(c instanceof Node ? c : String(c));
}

let toastTimer: number | undefined;
export function toast(message: string, action?: { label: string; run: () => void }) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); }
  clear(el, h('span', null, message), action && h('button', { class: 'toast-action', onclick: () => { el!.classList.remove('show'); action.run(); } }, action.label));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), action ? 8000 : 3500);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Load an image file with EXIF orientation applied (Safari/Chrome apply it to <img> by default). */
export function loadFileImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열 수 없습니다.')); };
    img.src = url;
  });
}
