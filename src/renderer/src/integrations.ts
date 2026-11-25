import { esc, icon, money, toast } from './ui';

export function renderIntegrations(mount: HTMLElement): void {
  mount.innerHTML = `
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-white">Integrações (sem chave de API)</h1>
      <p class="mt-1 text-sm text-slate-400">Teste as consultas externas usadas pelo sistema.</p>
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-3">
      ${panel('api-dollar', 'Cotação do dólar', 'dollar', 'AwesomeAPI → fallback Banco Central (PTAX).', `
        <button id="test-dollar" class="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-400">Consultar cotação</button>`)}
      ${panel('api-plate', 'Dados da placa', 'car', 'Consulta feita no cadastro de veículos da oficina.', `
        <div class="flex gap-2"><input id="plate-input" value="ABC1D23" class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400">
        <button id="test-plate" class="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-400">Buscar</button></div>`)}
      ${panel('api-fipe', 'Tabela FIPE', 'tag', 'API aberta do Preço FIPE (marca e modelo).', `
        <div class="flex gap-2"><input id="fipe-input" value="honda civic" placeholder="marca modelo" class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400">
        <button id="test-fipe" class="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-400">Buscar</button></div>`)}
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-3">
      ${resultBox('res-dollar', 'Resultado — cotação')}
      ${resultBox('res-plate', 'Resultado — placa')}
      ${resultBox('res-fipe', 'Resultado — FIPE')}
    </div>`;

  const show = (id: string, content: string) => {
    mount.querySelector(`#${id}`)!.innerHTML = content;
  };

  mount.querySelector('#test-dollar')?.addEventListener('click', async () => {
    show('res-dollar', '<p class="text-sm text-slate-500">Consultando...</p>');
    const r = await window.oficina.dollar(true);
    if (!r.ok) { show('res-dollar', errorHtml(r.error!)); return toast(r.error!, 'error'); }
    const d = r.data!;
    show('res-dollar', `<p class="text-lg font-semibold text-white">${money(d.ask)}</p><p class="mt-1 text-xs text-slate-400">Compra ${money(d.bid)} · ${esc(d.source)} · ${esc(d.fetchedAt)}</p>`);
  });

  mount.querySelector('#test-plate')?.addEventListener('click', async () => {
    const plate = mount.querySelector<HTMLInputElement>('#plate-input')!.value;
    show('res-plate', '<p class="text-sm text-slate-500">Consultando...</p>');
    const r = await window.oficina.plate(plate);
    if (!r.ok) { show('res-plate', errorHtml(r.error!)); return toast(r.error!, 'error'); }
    const result = r.data!;
    switch (result.status) {
      case 'invalid':
        show('res-plate', errorHtml(result.message));
        return toast(result.message, 'error');
      case 'not_found':
      case 'unavailable':
        show('res-plate', `<p class="text-sm text-slate-400">${esc(result.message)}</p>`);
        return toast(result.message, 'info');
      case 'found': {
        const p = result.data;
        show('res-plate', `<p class="font-semibold text-white">${esc(p.marca ?? '')} ${esc(p.modelo ?? '')}</p><p class="mt-1 text-xs text-slate-400">${esc(p.placa)} · ${p.anoFabricacao ?? '—'}/${p.anoModelo ?? '—'} · ${esc(p.cor ?? '')}</p><p class="mt-2 text-[11px] text-emerald-400">Dados obtidos do cadastro de veículos da oficina.</p>`);
        return;
      }
    }
  });

  mount.querySelector('#test-fipe')?.addEventListener('click', async () => {
    const [marca, modelo] = mount.querySelector<HTMLInputElement>('#fipe-input')!.value.trim().split(/\s+/);
    show('res-fipe', '<p class="text-sm text-slate-500">Consultando...</p>');
    const r = await window.oficina.fipe(marca ?? '', modelo ?? '');
    if (!r.ok) { show('res-fipe', errorHtml(r.error!)); return toast(r.error!, 'error'); }
    const items = r.data!;
    show('res-fipe', items.length
      ? items.slice(0, 3).map((v) => `<div class="border-b border-slate-800 py-2 last:border-0"><p class="text-sm text-slate-200">${esc(v.marca)} ${esc(v.modelo)}</p><p class="text-xs text-emerald-300">${money(v.precoMin)} – ${money(v.precoMax)} <span class="text-slate-500">· ${esc(v.referencia)}</span></p></div>`).join('')
      : '<p class="text-sm text-slate-500">Nenhum resultado.</p>');
  });
}

function panel(id: string, title: string, ico: string, description: string, control: string): string {
  return `<section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
    <div class="flex items-center gap-2 text-sm font-semibold text-white">${icon(ico, 'w-4 h-4 text-brand-400')} ${esc(title)}</div>
    <p class="mt-2 min-h-[40px] text-xs leading-5 text-slate-500">${esc(description)}</p>
    <div id="${id}" class="mt-4">${control}</div>
  </section>`;
}

function resultBox(id: string, title: string): string {
  return `<section class="min-h-[110px] rounded-xl border border-slate-800 bg-slate-950/50 p-4">
    <h3 class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">${esc(title)}</h3>
    <div id="${id}" class="mt-3 text-sm text-slate-300"><p class="text-slate-600">Aguardando consulta...</p></div>
  </section>`;
}

function errorHtml(error: string): string {
  return `<p class="text-sm text-rose-300">${esc(error)}</p>`;
}
