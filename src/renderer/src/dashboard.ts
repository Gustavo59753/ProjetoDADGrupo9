import type { DollarQuote, EntityName } from '@shared/types';
import { badge, dateFmt, esc, icon, money, toast } from './ui';

export async function renderDashboard(mount: HTMLElement, navigate: (entity: EntityName) => void): Promise<void> {
  mount.innerHTML = '<p class="text-sm text-slate-400">Carregando painel...</p>';
  const [statsRes, dollarRes] = await Promise.all([window.oficina.dashboard(), window.oficina.dollar()]);
  if (!statsRes.ok) return toast(statsRes.error!, 'error');

  const s = statsRes.data;
  const dollar = dollarRes.ok ? dollarRes.data as DollarQuote : null;
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  mount.innerHTML = `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-white">Visão geral</h1>
        <p class="mt-1 text-sm text-slate-400">${esc(today)}</p>
      </div>
      <button id="open-os" class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-400">
        ${icon('plus', 'w-4 h-4')} Nova ordem de serviço
      </button>
    </div>

    <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Ordens em andamento', s.osAbertas, 'clipboard', 'text-sky-300', 'ordens_servico')}
      ${card('Prontas para retirada', s.osProntas, 'check', 'text-emerald-300', 'ordens_servico')}
      ${card('Clientes cadastrados', s.clientes, 'users', 'text-violet-300', 'clientes')}
      ${card('Veículos na oficina', s.veiculos, 'car', 'text-amber-300', 'veiculos')}
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-3">
      <div class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-900/40 p-5 lg:col-span-2">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Cotação do dólar (sem chave de API)</p>
            <div class="mt-2 flex items-baseline gap-3">
              <span class="text-3xl font-semibold text-white">${dollar ? money(dollar.ask) : '—'}</span>
              ${dollar ? `<span class="text-sm ${dollar.variation < 0 ? 'text-emerald-400' : 'text-rose-400'}">${dollar.variation > 0 ? '+' : ''}${Number(dollar.variation).toFixed(2)}%</span>` : ''}
            </div>
            <p class="mt-1 text-xs text-slate-500">${dollar ? `${esc(dollar.source)} · ${esc(dollar.fetchedAt)}` : 'Fonte indisponível'}</p>
          </div>
          <button id="refresh-dollar" class="rounded-lg border border-slate-700 p-2.5 text-slate-400 hover:bg-slate-800 hover:text-white" title="Atualizar cotação">${icon('refresh', 'w-5 h-5')}</button>
        </div>
        <div class="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-3">
          <div><p class="text-[11px] uppercase text-slate-500">Compra</p><p class="text-sm text-slate-200">${dollar ? money(dollar.bid) : '—'}</p></div>
          <div><p class="text-[11px] uppercase text-slate-500">Venda</p><p class="text-sm text-slate-200">${dollar ? money(dollar.ask) : '—'}</p></div>
          <div><p class="text-[11px] uppercase text-slate-500">Total em OS</p><p class="text-sm text-emerald-300">${money(s.valorEmOS)}</p></div>
        </div>
      </div>

      <button id="go-stock" class="group rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 text-left hover:border-amber-400/50">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">${icon('alert', 'w-4 h-4')} Estoque baixo</div>
        <p class="mt-3 text-3xl font-semibold text-white">${s.estoqueBaixo}</p>
        <p class="mt-1 text-sm text-slate-400">peça(s) no estoque mínimo ou abaixo dele</p>
        <span class="mt-4 inline-flex items-center gap-1 text-xs font-medium text-amber-300 group-hover:gap-2">Ver peças ${icon('external', 'w-3.5 h-3.5')}</span>
      </button>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <section class="rounded-xl border border-slate-800 bg-slate-900/50">
        <div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 class="text-sm font-semibold text-white">Últimas ordens de serviço</h2>
          <button data-nav="ordens_servico" class="text-xs font-medium text-brand-400 hover:text-brand-300">Ver todas →</button>
        </div>
        <div class="divide-y divide-slate-800/70">
          ${s.recentes.length ? s.recentes.map((o: any) => `
            <div class="flex items-center justify-between gap-3 px-5 py-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-slate-200">${esc(o.numero)} · ${esc(o.veiculo_info)}</p>
                <p class="truncate text-xs text-slate-500">${esc(o.cliente_nome)} · ${dateFmt(o.data_entrada)}</p>
              </div>
              <div class="shrink-0 text-right">${badge(String(o.status))}<p class="mt-1 text-xs text-slate-300">${money(o.valor_total)}</p></div>
            </div>`).join('') : '<p class="px-5 py-8 text-center text-sm text-slate-500">Nenhuma ordem cadastrada.</p>'}
        </div>
      </section>

      <section class="rounded-xl border border-slate-800 bg-slate-900/50">
        <div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 class="text-sm font-semibold text-white">Peças para repor</h2>
          <button data-nav="pecas" class="text-xs font-medium text-brand-400 hover:text-brand-300">Ver estoque →</button>
        </div>
        <div class="divide-y divide-slate-800/70">
          ${s.baixoEstoque.length ? s.baixoEstoque.map((p: any) => `
            <div class="flex items-center justify-between gap-3 px-5 py-3">
              <div class="min-w-0"><p class="truncate text-sm font-medium text-slate-200">${esc(p.descricao)}</p><p class="text-xs text-slate-500">${esc(p.codigo)} · mínimo ${p.estoque_minimo}</p></div>
              <span class="shrink-0 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">${p.quantidade} un.</span>
            </div>`).join('') : '<p class="px-5 py-8 text-center text-sm text-slate-500">Estoque em dia.</p>'}
        </div>
      </section>
    </div>

    <div class="mt-5 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-xs leading-5 text-slate-500">
      ${icon('info', 'w-4 h-4 shrink-0 text-slate-400')}
      <p>Integrações sem chave: cotação do dólar via AwesomeAPI (fallback BACEN/PTAX), preços via Preço FIPE e avisos de retirada preparados como link do WhatsApp. A consulta de placa usa API pública quando disponível e, na ausência dela, preenche dados demonstrativos sinalizados na tela.</p>
    </div>`;

  mount.querySelector('#open-os')?.addEventListener('click', () => navigate('ordens_servico'));
  mount.querySelector('#go-stock')?.addEventListener('click', () => navigate('pecas'));
  mount.querySelectorAll<HTMLElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav as EntityName));
  });
  mount.querySelector('#refresh-dollar')?.addEventListener('click', async () => {
    const response = await window.oficina.dollar(true);
    if (!response.ok) return toast(response.error!, 'error');
    toast('Cotação atualizada.');
    renderDashboard(mount, navigate);
  });
}

function card(label: string, value: number, ico: string, color: string, nav: EntityName): string {
  return `<button data-nav="${nav}" class="group rounded-xl border border-slate-800 bg-slate-900/50 p-5 text-left transition hover:border-slate-700 hover:bg-slate-900">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wider text-slate-500">${esc(label)}</span>
      <span class="${color}">${icon(ico, 'w-5 h-5')}</span>
    </div>
    <p class="mt-3 text-3xl font-semibold text-white">${value}</p>
    <span class="mt-2 inline-block text-xs text-brand-400 group-hover:text-brand-300">Abrir módulo →</span>
  </button>`;
}
