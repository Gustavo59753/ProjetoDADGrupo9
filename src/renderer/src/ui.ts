import { STATUS_COLORS } from '@shared/schema';
import type { FieldDef } from '@shared/types';

export function escapeHTML(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Alias temporário para compatibilidade; use `escapeHTML` no código novo. */
export const esc = escapeHTML;

export function money(value: unknown): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dateFmt(value: unknown): string {
  if (!value) return '—';
  const str = String(value);
  const d = new Date(str.length <= 10 ? `${str}T12:00:00` : str.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? str : d.toLocaleDateString('pt-BR');
}

const PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  car: '<path d="M5 17h14M6 17l-1-5 2-5h10l2 5-1 5"/><path d="M4 12h16"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M7 9V7h10v2"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-3-3 3-3Z"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  truck: '<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  message: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9Z"/><path d="M8 10h8M8 14h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  dollar: '<path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 9.5 12 10s5 1.5 5 3.5-2.2 3.5-5 3.5-5-1.1-5-3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v6h-6"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/>',
  sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19 19 0 0 1-8.3-3 19 19 0 0 1-5.8-5.8 19 19 0 0 1-3-8.3A2 2 0 0 1 4.7 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 1.9Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16l4-5 3 3 5-7"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>',
  tag: '<path d="M20 12 12 20 4 12V4h8l8 8Z"/><path d="M8 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

export function icon(name: string, cls = 'w-5 h-5'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.info}</svg>`;
}

export function badge(text: string): string {
  const color = STATUS_COLORS[text] ?? 'bg-slate-700/40 text-slate-300 ring-slate-600/40';
  return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${color}">${escapeHTML(String(text).replace(/_/g, ' '))}</span>`;
}

export function toast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  const root = document.getElementById('toast-root')!;
  const colors = {
    success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200',
    error: 'border-rose-500/40 bg-rose-950/90 text-rose-200',
    info: 'border-sky-500/40 bg-sky-950/90 text-sky-200',
  };
  const item = document.createElement('div');
  item.className = `animate-in flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${colors[type]}`;
  item.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 'w-4 h-4 mt-0.5 shrink-0')}<span>${escapeHTML(message)}</span>`;
  root.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

export interface ModalHandle {
  element: HTMLElement;
  close: () => void;
}

export function openModal(title: string, content: string, width = 'max-w-3xl'): ModalHandle {
  const root = document.getElementById('modal-root')!;
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-6 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="animate-in my-auto w-full ${escapeHTML(width)} overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <h3 class="text-base font-semibold text-white">${escapeHTML(title)}</h3>
        <button data-close class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">${icon('x', 'w-5 h-5')}</button>
      </div>
      <div class="modal-body max-h-[calc(100vh-9rem)] overflow-y-auto px-6 py-5">${content}</div>
    </div>`;
  root.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  return { element: overlay, close };
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = openModal('Confirmar exclusão', `
      <p class="text-sm leading-6 text-slate-300">${escapeHTML(message)}</p>
      <div class="mt-6 flex justify-end gap-3">
        <button data-cancel class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancelar</button>
        <button data-confirm class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500">Excluir</button>
      </div>`, 'max-w-md');
    modal.element.querySelector('[data-cancel]')?.addEventListener('click', () => { modal.close(); resolve(false); });
    modal.element.querySelector('[data-confirm]')?.addEventListener('click', () => { modal.close(); resolve(true); });
  });
}

export function fieldHtml(field: FieldDef, value: unknown, options: { id: number; label: string }[] = []): string {
  const v = value ?? '';
  const key = escapeHTML(field.key);
  const common = `name="${key}" id="f_${key}" class="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"`;
  const label = `<label for="f_${key}" class="mb-1.5 block text-xs font-medium text-slate-400">${escapeHTML(field.label)}${field.required ? ' <span class="text-rose-400">*</span>' : ''}</label>`;
  const hint = field.hint ? `<p class="mt-1.5 text-[11px] leading-4 text-slate-500">${escapeHTML(field.hint)}</p>` : '';
  let control = '';

  if (field.type === 'textarea') {
    control = `<textarea ${common} rows="3" placeholder="${escapeHTML(field.placeholder ?? '')}">${escapeHTML(v)}</textarea>`;
  } else if (field.type === 'select' || field.type === 'ref') {
    const opts = field.type === 'ref'
      ? options.map((o) => `<option value="${escapeHTML(o.id)}" ${String(v) === String(o.id) ? 'selected' : ''}>${escapeHTML(o.label)}</option>`).join('')
      : (field.options ?? []).map((o) => `<option value="${escapeHTML(o)}" ${String(v) === o ? 'selected' : ''}>${escapeHTML(o)}</option>`).join('');
    control = `<select ${common}><option value="">Selecione...</option>${opts}</select>`;
  } else if (field.type === 'checkbox') {
    control = `<label class="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
      <input type="checkbox" name="${key}" id="f_${key}" class="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-brand-500" ${v ? 'checked' : ''}>
      <span>${escapeHTML(field.hint ?? 'Sim')}</span></label>`;
  } else {
    const type = field.type === 'money' ? 'number' : field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
    const step = field.type === 'money' || field.type === 'number' ? 'step="any"' : '';
    control = `<input type="${escapeHTML(type)}" ${escapeHTML(step)} ${common} value="${escapeHTML(v)}" placeholder="${escapeHTML(field.placeholder ?? '')}">`;
  }

  const inner = field.type === 'checkbox'
    ? `<div class="${field.full ? 'md:col-span-2' : ''}">${control}</div>`
    : `<div class="${field.full ? 'md:col-span-2' : ''}">${label}${control}${hint}</div>`;
  return inner;
}

export function readForm(root: HTMLElement, fields: FieldDef[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${field.key}"]`);
    if (!input) continue;
    if (field.type === 'checkbox') data[field.key] = (input as HTMLInputElement).checked ? 1 : 0;
    else data[field.key] = (input as HTMLInputElement).value;
  }
  return data;
}

export function validateForm(fields: FieldDef[], data: Record<string, unknown>): string | null {
  for (const field of fields) {
    if (!field.required) continue;
    const value = data[field.key];
    if (value === '' || value === null || value === undefined) return `O campo "${field.label}" é obrigatório.`;
  }
  return null;
}
