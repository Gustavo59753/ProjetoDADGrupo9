import './style.css';
import { ENTITIES } from '@shared/schema';
import type { EntityName } from '@shared/types';
import { renderCrud } from './crud';
import { renderDashboard } from './dashboard';
import { renderIntegrations } from './integrations';
import { renderOrdens } from './ordens';
import { esc, icon } from './ui';

type Route = 'dashboard' | 'integracoes' | EntityName;

const NAV: { group: string; items: { route: Route; label: string; icon: string }[] }[] = [
  {
    group: 'Principal',
    items: [
      { route: 'dashboard', label: 'Visão geral', icon: 'home' },
      { route: 'integracoes', label: 'Integrações', icon: 'sparkles' },
    ],
  },
  {
    group: 'Cadastros',
    items: [
      { route: 'clientes', label: 'Clientes', icon: 'users' },
      { route: 'veiculos', label: 'Veículos', icon: 'car' },
      { route: 'mecanicos', label: 'Mecânicos', icon: 'wrench' },
      { route: 'fornecedores', label: 'Fornecedores', icon: 'truck' },
      { route: 'pecas', label: 'Peças e estoque', icon: 'box' },
    ],
  },
  {
    group: 'Operação',
    items: [
      { route: 'ordens_servico', label: 'Ordens de serviço', icon: 'clipboard' },
      { route: 'itens_ordem', label: 'Peças por ordem', icon: 'list' },
      { route: 'notificacoes', label: 'Avisos enviados', icon: 'message' },
    ],
  },
];

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="flex h-full">
    <aside class="flex w-[264px] shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      <div class="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-500/20">${icon('wrench', 'w-5 h-5')}</div>
        <div>
          <p class="text-sm font-semibold tracking-tight text-white">Oficina Manager</p>
          <p class="text-[11px] text-slate-500">Gestão de atendimento</p>
        </div>
      </div>
      <nav class="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        ${NAV.map((group) => `
          <div>
            <p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">${esc(group.group)}</p>
            <div class="space-y-1">
              ${group.items.map((item) => `
                <button data-route="${item.route}" class="nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-100">
                  ${icon(item.icon, 'w-[18px] h-[18px]')}<span>${esc(item.label)}</span>
                </button>`).join('')}
            </div>
          </div>`).join('')}
      </nav>
      <div class="border-t border-slate-800 px-5 py-4">
        <div class="flex items-center gap-2 text-[11px] text-slate-500">
          <span class="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60"></span>
          SQLite local · APIs sem chave
        </div>
        <p class="mt-1 text-[10px] text-slate-600">v1.0.0 · Projeto DAD — Grupo 9</p>
      </div>
    </aside>

    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/50 px-8">
        <div class="flex items-center gap-2 text-xs text-slate-500">
          <span>Oficina</span><span class="text-slate-700">/</span><span id="breadcrumb" class="text-slate-300">Visão geral</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300">Dados no computador</span>
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">OM</div>
        </div>
      </header>
      <div id="content" class="flex-1 overflow-y-auto p-8"></div>
    </main>
  </div>`;

const content = document.getElementById('content')!;
let renderToken = 0;

function currentRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, '') as Route;
  if (raw === 'dashboard' || raw === 'integracoes' || raw in ENTITIES) return raw;
  return 'dashboard';
}

function setActive(route: Route): void {
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((btn) => {
    const active = btn.dataset.route === route;
    btn.classList.toggle('bg-brand-500/15', active);
    btn.classList.toggle('text-brand-200', active);
    btn.classList.toggle('ring-1', active);
    btn.classList.toggle('ring-brand-500/25', active);
  });
  const label = NAV.flatMap((g) => g.items).find((i) => i.route === route)?.label ?? 'Visão geral';
  document.getElementById('breadcrumb')!.textContent = label;
}

function navigate(route: Route): void {
  location.hash = `/${route}`;
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const route = currentRoute();
  setActive(route);

  if (route === 'dashboard') {
    await renderDashboard(content, navigate);
    return;
  }
  if (route === 'integracoes') {
    renderIntegrations(content);
    return;
  }
  content.innerHTML = '<p class="text-sm text-slate-400">Carregando...</p>';
  if (token !== renderToken) return;

  if (route === 'ordens_servico') await renderOrdens(content);
  else await renderCrud(route, content);
}

app.querySelectorAll<HTMLElement>('[data-route]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.route as Route));
});
window.addEventListener('hashchange', render);
render();
