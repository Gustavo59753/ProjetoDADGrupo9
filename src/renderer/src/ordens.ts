import type { DollarQuote } from '@shared/types';
import { isValidEmail } from '@shared/validation';
import { renderCrud } from './crud';
import { badge, dateFmt, escapeHTML, icon, money, openModal, toast } from './ui';

type Row = Record<string, any>;

export function renderOrdens(mount: HTMLElement): Promise<void> {
  return renderCrud('ordens_servico', mount, {
    extraActions: (row) => `
      <button data-extra="open" data-id="${escapeHTML(row.id)}" title="Abrir ordem" class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/15">
        ${icon('clipboard', 'w-4 h-4')} Abrir
      </button>`,
    onExtraAction: (_action, row, reload) => openOsDetail(Number(row.id), reload),
  });
}

async function openOsDetail(osId: number, reload: () => void): Promise<void> {
  const modal = openModal('Detalhes da ordem de serviço', '<div id="os-detail"><p class="text-sm text-slate-400">Carregando...</p></div>', 'max-w-5xl');
  const body = modal.element.querySelector<HTMLElement>('#os-detail')!;

  async function refresh(): Promise<void> {
    const [osRes, itemsRes, pecasRes, dollarRes] = await Promise.all([
      window.oficina.get('ordens_servico', osId),
      window.oficina.listItems(osId),
      window.oficina.list('pecas'),
      window.oficina.dollar(),
    ]);
    if (!osRes.ok || !itemsRes.ok) return toast('Não foi possível carregar a ordem.', 'error');

    const os = osRes.data as Row;
    const items = itemsRes.data as Row[];
    const pecas = (pecasRes.data ?? []) as Row[];
    const dollar = dollarRes.ok ? dollarRes.data as DollarQuote : null;
    const subtotal = items.reduce((sum, i) => sum + Number(i.subtotal), 0);
    const total = Number(os.valor_total);

    body.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <span class="text-2xl font-semibold text-white">${escapeHTML(os.numero)}</span>
            ${badge(String(os.status))}
          </div>
          <p class="mt-1.5 text-sm text-slate-400">${escapeHTML(os.veiculo_info)} · ${escapeHTML(os.cliente_nome)} · Responsável: ${escapeHTML(os.mecanico_nome ?? '—')}</p>
          <p class="mt-1 text-xs text-slate-500">Entrada: ${escapeHTML(dateFmt(os.data_entrada))} · Saída/previsão: ${escapeHTML(dateFmt(os.data_saida))} · Cotação USD: ${os.cotacao_dolar ? escapeHTML(money(os.cotacao_dolar)) : 'não registrada'}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${os.status !== 'PRONTA' && os.status !== 'ENTREGUE' ? '<button id="os-ready" class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">Marcar como pronta</button>' : ''}
          <button id="os-notify" class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
            ${icon('message', 'w-4 h-4')} Avisar cliente (WhatsApp)
          </button>
          <button id="os-notify-email" class="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-600">
            ${icon('message', 'w-4 h-4')} Avisar cliente por e-mail
          </button>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${stat('Peças', money(subtotal), 'box')}
        ${stat('Mão de obra', money(os.valor_mao_obra), 'wrench')}
        ${stat('Desconto', money(os.desconto), 'tag')}
        ${stat('Total', money(total), 'calculator', true)}
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Problema relatado</h4>
          <p class="text-sm leading-6 text-slate-300">${escapeHTML(os.descricao_problema ?? '—')}</p>
          <h4 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Serviço executado</h4>
          <p class="text-sm leading-6 text-slate-300">${escapeHTML(os.descricao_servico ?? '—')}</p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h4 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Cotação do dólar para peças importadas</h4>
          <p class="text-sm text-slate-300">${dollar ? `<span class="font-semibold text-white">${escapeHTML(money(dollar.ask))}</span> <span class="text-slate-500">(${escapeHTML(dollar.source)} · ${escapeHTML(dollar.fetchedAt)})</span>` : 'Indisponível no momento'}</p>
          <button id="os-dollar" class="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">
            ${icon('refresh', 'w-4 h-4')} Registrar cotação nesta OS
          </button>
          <p class="mt-3 text-[11px] leading-4 text-slate-500">Peças com moeda USD podem ter o custo convertido usando esta cotação na composição do preço final.</p>
        </div>
      </div>

      <div class="mt-6">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-semibold text-white">Peças utilizadas</h4>
          <span class="text-xs text-slate-500">${escapeHTML(items.length)} item(ns)</span>
        </div>
        <div class="mt-3 overflow-hidden rounded-xl border border-slate-800">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-800/50 text-[11px] uppercase tracking-wider text-slate-400">
              <tr><th class="px-3 py-2.5">Peça</th><th class="px-3 py-2.5">Qtd.</th><th class="px-3 py-2.5">Unitário</th><th class="px-3 py-2.5">Subtotal</th><th></th></tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              ${items.length ? items.map((i) => `
                <tr class="hover:bg-slate-800/30">
                  <td class="px-3 py-2.5 text-slate-200">${escapeHTML(i.peca_descricao)} <span class="text-slate-500">· ${escapeHTML(i.peca_codigo)}</span></td>
                  <td class="px-3 py-2.5 text-slate-300">${escapeHTML(i.quantidade)}</td>
                  <td class="px-3 py-2.5 text-slate-300">${escapeHTML(money(i.preco_unitario))}</td>
                  <td class="px-3 py-2.5 text-emerald-300">${escapeHTML(money(i.subtotal))}</td>
                  <td class="px-3 py-2.5 text-right"><button data-remove-item="${escapeHTML(i.id)}" class="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300">${icon('trash', 'w-4 h-4')}</button></td>
                </tr>`).join('')
                : '<tr><td colspan="5" class="px-3 py-6 text-center text-slate-500">Nenhuma peça adicionada.</td></tr>'}
            </tbody>
          </table>
        </div>

        <form id="os-add-item" class="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <label class="text-xs text-slate-400">Peça
            <select name="peca_id" class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400">
              ${pecas.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.descricao)} · estoque ${escapeHTML(p.quantidade)} · ${escapeHTML(money(p.preco_venda))}</option>`).join('')}
            </select>
          </label>
          <label class="text-xs text-slate-400">Quantidade
            <input name="quantidade" type="number" min="1" value="1" class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400">
          </label>
          <label class="text-xs text-slate-400">Preço unitário (R$)
            <input name="preco_unitario" type="number" step="any" placeholder="Preço da peça" class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400">
          </label>
          <button type="submit" class="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">Adicionar</button>
        </form>
      </div>`;

    body.querySelectorAll<HTMLElement>('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const response = await window.oficina.removeItem(Number(btn.dataset.removeItem));
        if (!response.ok) return toast(response.error!, 'error');
        toast('Peça removida e estoque devolvido.');
        refresh(); reload();
      });
    });

    body.querySelector('#os-add-item')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const response = await window.oficina.addItem(osId, {
        peca_id: Number(data.get('peca_id')),
        quantidade: Number(data.get('quantidade')),
        preco_unitario: data.get('preco_unitario') ? Number(data.get('preco_unitario')) : undefined,
      });
      if (!response.ok) return toast(response.error!, 'error');
      toast('Peça adicionada; estoque e total atualizados.');
      refresh(); reload();
    });

    body.querySelector('#os-dollar')?.addEventListener('click', async () => {
      if (!dollar) return toast('Cotação indisponível.', 'error');
      const response = await window.oficina.setDollar(osId, dollar.ask);
      if (!response.ok) return toast(response.error!, 'error');
      toast('Cotação registrada na ordem de serviço.');
      refresh(); reload();
    });

    body.querySelector('#os-ready')?.addEventListener('click', async () => {
      const response = await window.oficina.update('ordens_servico', osId, { status: 'PRONTA' });
      if (!response.ok) return toast(response.error!, 'error');
      toast('Ordem marcada como pronta.');
      refresh(); reload();
    });

    body.querySelector('#os-notify')?.addEventListener('click', async () => {
      const response = await window.oficina.notify(osId);
      if (!response.ok) return toast(response.error!, 'error');
      const result = response.data!;
      toast('Mensagem preparada. Confirme o envio no WhatsApp que foi aberto.', 'info');
      const box = document.createElement('div');
      box.className = 'mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4';
      box.innerHTML = `
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-semibold uppercase tracking-wider text-emerald-300">Mensagem para o cliente</span>
          <button id="copy-msg" class="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">${icon('copy', 'w-3.5 h-3.5')} Copiar</button>
        </div>
        <p class="mt-2 text-sm leading-6 text-slate-300">${escapeHTML(result.message)}</p>`;
      body.appendChild(box);
      box.querySelector('#copy-msg')?.addEventListener('click', async () => {
        await window.oficina.clipboard(result.message);
        toast('Mensagem copiada.');
      });
      reload();
    });

    body.querySelector('#os-notify-email')?.addEventListener('click', async () => {
      let email = '';
      let clienteId: number | undefined;
      try {
        const veiculoRes = await window.oficina.get('veiculos', Number(os.veiculo_id));
        if (veiculoRes.ok && veiculoRes.data?.cliente_id) {
          const id = Number(veiculoRes.data.cliente_id);
          if (Number.isFinite(id) && id > 0) {
            clienteId = id;
            const clienteRes = await window.oficina.get('clientes', id);
            if (clienteRes.ok) email = String(clienteRes.data?.email ?? '').trim();
          }
        }
      } catch {
        // Cadastro indisponível: solicita o e-mail diretamente ao usuário.
      }
      if (!email) {
        const informado = window.prompt('E-mail do cliente:');
        if (!informado || !informado.trim()) return toast('Informe o e-mail do cliente para preparar o aviso.', 'info');
        email = informado.trim();
      }
      if (!isValidEmail(email)) return toast('E-mail inválido. Informe um endereço com domínio e extensão.', 'error');

      const assunto = `Ordem de serviço ${os.numero}`;
      const situacao = String(os.status ?? '').replace(/_/g, ' ').toLowerCase();
      const mensagem = `Olá! A ordem de serviço ${os.numero} (${os.veiculo_info}) está ${situacao}. Valor total: ${money(total)}. Qualquer dúvida, fale com a oficina.`;
      const payload: Record<string, unknown> = {
        ordem_servico_id: osId,
        canal: 'E-mail',
        destino: email,
        mensagem,
        assunto,
      };
      if (clienteId) payload.cliente_id = clienteId;
      try {
        const response = await window.oficina.createNotification(payload);
        if (!response.ok) return toast(response.error!, 'error');
        toast('Aviso por e-mail preparado. Confirme o envio no app de e-mail aberto.', 'info');
        reload();
      } catch {
        toast('Não foi possível preparar o aviso por e-mail.', 'error');
      }
    });
  }

  await refresh();
}

function stat(label: string, value: string, ico: string, highlight = false): string {
  return `<div class="rounded-xl border ${highlight ? 'border-brand-500/40 bg-brand-500/10' : 'border-slate-800 bg-slate-950/40'} p-4">
    <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">${icon(ico, 'w-4 h-4')} ${escapeHTML(label)}</div>
    <div class="mt-2 text-lg font-semibold ${highlight ? 'text-brand-100' : 'text-slate-100'}">${escapeHTML(value)}</div>
  </div>`;
}
