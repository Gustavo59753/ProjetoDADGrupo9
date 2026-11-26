import { DEFAULT_VALUES, ENTITIES } from '@shared/schema';
import type { ApiResponse, CnpjData, EntityName, FieldDef, LookupResult } from '@shared/types';
import { maskPhone } from '@shared/validation';
import { digits, maskDocument, setupClientForm } from './clientes';
import { setupEmailField } from './email';
import { normalizeChannel, setupNotificationForm } from './notificacoes';
import { bindInputMask, setupPhoneFields } from './phone';
import { badge, confirmDialog, dateFmt, escapeHTML, fieldHtml, icon, money, openModal, readForm, toast, validateForm } from './ui';

type Row = Record<string, any>;
type LookupStatus = 'found' | 'invalid' | 'not_found' | 'unavailable' | 'error';
type CnpjLookup = { digits: string; status: LookupStatus; message: string };

const CNPJ_FALLBACK: Record<Exclude<LookupStatus, 'found'>, string> = {
  invalid: 'CNPJ inválido. Confira os dígitos e tente novamente.',
  not_found: 'CNPJ inexistente na base consultada. Confira o número digitado.',
  unavailable: 'Consulta ao CNPJ indisponível no momento. Tente novamente mais tarde.',
  error: 'Não foi possível consultar o CNPJ. Tente novamente mais tarde.',
};

function newLabel(entity: EntityName, singular: string): string {
  if (entity === 'pecas') return 'Nova peça';
  if (entity === 'ordens_servico') return 'Nova ordem de serviço';
  return `Novo ${singular.toLowerCase()}`;
}

async function loadRefOptions(fields: FieldDef[]): Promise<Record<string, { id: number; label: string }[]>> {
  const result: Record<string, { id: number; label: string }[]> = {};
  await Promise.all(fields.filter((f) => f.type === 'ref').map(async (f) => {
    const response = await window.oficina.options(f.ref!, f.refLabel);
    result[f.key] = response.ok ? response.data! : [];
  }));
  return result;
}

function cellHtml(row: Row, key: string, render?: string): string {
  const value = row[key];
  if (render === 'money') return escapeHTML(money(value));
  if (render === 'date') return escapeHTML(dateFmt(value));
  if (render === 'badge') return badge(String(value ?? '—'));
  if (render === 'checkbox') return value
    ? '<span class="text-emerald-400">' + icon('check', 'w-4 h-4') + '</span>'
    : '<span class="text-slate-600">' + icon('x', 'w-4 h-4') + '</span>';
  return value === null || value === undefined || value === '' ? '<span class="text-slate-600">—</span>' : escapeHTML(value);
}

export interface CrudOptions {
  onSaved?: () => void;
  extraActions?: (row: Row, reload: () => void) => string;
  onExtraAction?: (action: string, row: Row, reload: () => void) => void;
}

const INFO_BASE = 'mt-3 rounded-lg border p-3 text-xs leading-5';
const INFO_COLORS = {
  info: 'border-sky-500/40 bg-sky-950/60 text-sky-200',
  error: 'border-rose-500/40 bg-rose-950/60 text-rose-200',
  success: 'border-emerald-500/40 bg-emerald-950/60 text-emerald-200',
};

function formatSupplierAddress(data: CnpjData): string {
  const logradouro = [data.logradouro, data.numero, data.complemento]
    .filter((part) => part && String(part).trim()).join(', ');
  const bairro = data.bairro?.trim();
  const cidadeUf = [data.cidade, data.uf].filter((part) => part && String(part).trim()).join('/');
  const endereco = [logradouro, bairro].filter(Boolean).join(' - ');
  const localizacao = [endereco, cidadeUf].filter(Boolean).join(', ');
  const cep = data.cep?.trim();
  return `${localizacao}${cep ? ` - CEP ${cep}` : ''}`;
}

/**
 * Configura máscara, consulta e bloqueio de submit do CNPJ de fornecedores.
 * O estado do último lookup vive no closure; na edição ele já começa como `found`
 * para o CNPJ gravado, evitando consulta desnecessária quando não é alterado.
 */
function setupSupplierCnpj(form: HTMLFormElement, root: HTMLElement, initialCnpj?: unknown): () => boolean {
  const input = form.querySelector<HTMLInputElement>('[name="cnpj"]');
  const button = root.querySelector<HTMLButtonElement>('#cnpj-lookup');
  const info = root.querySelector<HTMLElement>('#lookup-info');
  if (!input || !button || !info) return () => true;

  input.placeholder = '00.000.000/0000-00';
  input.setAttribute('inputmode', 'numeric');
  input.value = maskDocument(input.value, 'PJ');
  let hint = root.querySelector<HTMLElement>('#f_cnpj-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'f_cnpj-hint';
    hint.className = 'mt-1.5 text-[11px] leading-4 text-slate-500';
    input.parentElement?.appendChild(hint);
  }
  hint.textContent = 'CNPJ com 14 dígitos. Clique em “Buscar CNPJ” para preencher os dados da empresa.';
  input.setAttribute('aria-describedby', hint.id);

  const cnpjGravado = initialCnpj === null || initialCnpj === undefined ? '' : digits(String(initialCnpj));
  let lookup: CnpjLookup | null = cnpjGravado
    ? { digits: cnpjGravado, status: 'found', message: '' }
    : null;

  function showInfo(message: string, kind: keyof typeof INFO_COLORS): void {
    info!.textContent = message;
    info!.className = `${INFO_BASE} ${INFO_COLORS[kind]}`;
    if (kind === 'error') {
      info!.setAttribute('role', 'alert');
      info!.removeAttribute('aria-live');
    } else {
      info!.setAttribute('role', 'status');
      info!.setAttribute('aria-live', 'polite');
    }
  }

  function hideInfo(): void {
    info!.textContent = '';
    info!.className = `${INFO_BASE} hidden border-slate-700 bg-slate-950/60 text-slate-300`;
    info!.setAttribute('role', 'status');
    info!.setAttribute('aria-live', 'polite');
  }

  function setIfEmpty(name: string, value: unknown): void {
    const control = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    const text = value === null || value === undefined ? '' : String(value);
    if (control && text && !control.value.trim()) control.value = text;
  }

  function appendObservation(text: string): void {
    const field = form.querySelector<HTMLTextAreaElement>('[name="observacoes"]');
    if (!field || !text || field.value.includes(text)) return;
    const atual = field.value.trimEnd();
    field.value = atual ? `${atual}\n${text}` : text;
  }

  bindInputMask(input, (value) => maskDocument(value, 'PJ'), () => {
    input.removeAttribute('aria-invalid');
    if (lookup && lookup.digits !== digits(input.value)) {
      showInfo('CNPJ alterado após a consulta. Clique em “Buscar CNPJ” novamente antes de salvar.', 'info');
    }
  });

  button.addEventListener('click', async () => {
    const d = digits(input.value);
    if (!d) {
      showInfo('Digite o CNPJ antes de buscar.', 'error');
      toast('Digite o CNPJ antes de buscar.', 'error');
      input.focus();
      return;
    }

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    let response: ApiResponse<LookupResult<CnpjData>>;
    try {
      response = await window.oficina.cnpj(d);
    } catch {
      const message = CNPJ_FALLBACK.error;
      lookup = { digits: d, status: 'error', message };
      showInfo(message, 'error');
      toast(message, 'error');
      button.disabled = false;
      button.removeAttribute('aria-busy');
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');

    if (!response.ok) {
      const message = response.error?.trim() || CNPJ_FALLBACK.error;
      lookup = { digits: d, status: 'error', message };
      showInfo(message, 'error');
      toast(message, 'error');
      return;
    }

    const result = response.data!;
    if (result.status === 'found') {
      const data = result.data;
      const razao = String(data.razao_social || data.nome_fantasia || '').trim();
      const fantasia = String(data.nome_fantasia || '').trim();
      setIfEmpty('razao_social', razao);
      if (fantasia && fantasia.toLocaleLowerCase('pt-BR') !== razao.toLocaleLowerCase('pt-BR')) {
        setIfEmpty('contato', fantasia);
      }
      setIfEmpty('pais', 'Brasil');
      setIfEmpty('telefone', data.telefone);
      setIfEmpty('email', data.email);
      const telefone = form.querySelector<HTMLInputElement>('[name="telefone"]');
      if (telefone) telefone.value = maskPhone(telefone.value);

      const observacoes: string[] = [];
      const endereco = formatSupplierAddress(data);
      if (endereco) observacoes.push(`Endereço (Minha Receita): ${endereco}`);
      const situacao = data.situacao?.trim();
      if (situacao) observacoes.push(`Situação: ${situacao}`);
      if (observacoes.length) appendObservation(observacoes.join('\n'));

      input.value = maskDocument(input.value || data.cnpj, 'PJ');
      lookup = { digits: d, status: 'found', message: '' };
      input.removeAttribute('aria-invalid');
      showInfo('Dados da empresa preenchidos via Minha Receita. Confira telefone e e-mail antes de salvar.', 'success');
      toast('Dados do fornecedor preenchidos via Minha Receita.', 'success');
      return;
    }

    const message = result.message?.trim() || CNPJ_FALLBACK[result.status];
    lookup = { digits: d, status: result.status, message };
    if (result.status === 'invalid') input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    showInfo(message, 'error');
    toast(message, result.status === 'unavailable' ? 'info' : 'error');
  });

  return function validateSupplierCnpj(): boolean {
    const d = digits(input.value);
    if (!d) {
      input.removeAttribute('aria-invalid');
      hideInfo();
      return true;
    }

    let message: string | null = null;
    if (!lookup) {
      message = 'Consulte o CNPJ digitado (botão “Buscar CNPJ”) antes de salvar.';
    } else if (lookup.digits !== d) {
      message = 'O CNPJ foi alterado. Clique em “Buscar CNPJ” novamente antes de salvar.';
    } else if (lookup.status !== 'found') {
      message = lookup.message || CNPJ_FALLBACK[lookup.status];
    }

    if (!message) {
      input.removeAttribute('aria-invalid');
      return true;
    }
    input.setAttribute('aria-invalid', 'true');
    showInfo(message, 'error');
    input.focus();
    toast(message, 'error');
    return false;
  };
}

export async function renderCrud(entity: EntityName, mount: HTMLElement, opts: CrudOptions = {}): Promise<void> {
  const meta = ENTITIES[entity];
  let search = '';
  let rows: Row[] = [];

  async function reload(): Promise<void> {
    const response = await window.oficina.list(entity, search);
    if (!response.ok) return toast(response.error!, 'error');
    rows = response.data!;
    paint();
  }

  function paint(): void {
    mount.innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-white">${escapeHTML(meta.label)}</h1>
          <p class="mt-1 text-sm text-slate-400">${escapeHTML(rows.length)} registro${rows.length === 1 ? '' : 's'} cadastrado${rows.length === 1 ? '' : 's'}</p>
        </div>
        <div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <div class="relative min-w-[240px] flex-1">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">${icon('search', 'w-4 h-4')}</span>
            <input id="crud-search" value="${escapeHTML(search)}" placeholder="Buscar..." class="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-brand-400">
          </div>
          <button id="crud-new" class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-400">
            ${icon('plus', 'w-4 h-4')} ${escapeHTML(newLabel(entity, meta.singular))}
          </button>
        </div>
      </div>

      <div class="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="bg-slate-800/50 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>${meta.listColumns.map((c) => `<th class="whitespace-nowrap px-4 py-3 font-semibold">${escapeHTML(c.label)}</th>`).join('')}<th class="px-4 py-3 text-right font-semibold">Ações</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-800/80">
              ${rows.length ? rows.map((row) => `
                <tr class="transition hover:bg-slate-800/40">
                  ${meta.listColumns.map((c) => `<td class="whitespace-nowrap px-4 py-3 text-slate-300">${cellHtml(row, c.key, c.render)}</td>`).join('')}
                  <td class="whitespace-nowrap px-4 py-3 text-right">
                    <div class="inline-flex items-center gap-1">
                      ${opts.extraActions ? opts.extraActions(row, reload) : ''}
                      <button data-edit="${escapeHTML(row.id)}" title="Editar" aria-label="Editar ${escapeHTML(String(row[meta.listColumns[0].key] ?? row.id))}" class="rounded-md p-1.5 text-slate-400 hover:bg-slate-700/60 hover:text-white">${icon('edit', 'w-4 h-4')}</button>
                      <button data-delete="${escapeHTML(row.id)}" title="Inativar" aria-label="Inativar ${escapeHTML(String(row[meta.listColumns[0].key] ?? row.id))}" class="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-300">${icon('trash', 'w-4 h-4')}</button>
                    </div>
                  </td>
                </tr>`).join('')
                : `<tr><td colspan="${escapeHTML(meta.listColumns.length + 1)}" class="px-4 py-14 text-center text-slate-500">Nenhum registro encontrado.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    const searchInput = mount.querySelector<HTMLInputElement>('#crud-search')!;
    let timer: number | undefined;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => { search = searchInput.value; reload(); }, 260);
    });
    mount.querySelector('#crud-new')?.addEventListener('click', () => openForm());
    mount.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openForm(rows.find((r) => r.id === Number((btn as HTMLElement).dataset.edit))));
    });
    mount.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.delete);
        const row = rows.find((r) => r.id === id);
        const ok = await confirmDialog(`Inativar ${meta.singular.toLowerCase()} "${row?.[meta.listColumns[0].key] ?? id}"? O registro ficará inativo e não aparecerá nas listagens.`);
        if (!ok) return;
        const response = await window.oficina.remove(entity, id);
        if (!response.ok) return toast(response.error!, 'error');
        toast('Registro inativado com sucesso.');
        reload();
        opts.onSaved?.();
      });
    });
    if (opts.onExtraAction) {
      mount.querySelectorAll<HTMLElement>('[data-extra]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = rows.find((r) => r.id === Number(btn.dataset.id));
          if (row) opts.onExtraAction!(btn.dataset.extra!, row, reload);
        });
      });
    }
  }

  async function openForm(row?: Row): Promise<void> {
    const refs = await loadRefOptions(meta.fields);
    const defaults: Row = { ...(DEFAULT_VALUES[entity] ?? {}) };

    if (entity === 'ordens_servico' && !row) {
      const all = await window.oficina.list('ordens_servico');
      const max = (all.data ?? []).reduce((acc: number, r: any) => {
        const n = Number(String(r.numero).replace(/\D/g, ''));
        return Math.max(acc, n);
      }, 0);
      defaults.numero = `OS-${String(max + 1).padStart(4, '0')}`;
    }

    const values: Row = { ...defaults, ...(row ?? {}) };
    const modal = openModal(`${row ? 'Editar' : 'Novo'} ${meta.singular.toLowerCase()}`, `
      <form id="crud-form">
        <div class="grid gap-4 md:grid-cols-2">
          ${meta.fields.map((f) => fieldHtml(f, values[f.key], refs[f.key] ?? [])).join('')}
        </div>
        ${entity === 'veiculos' ? `
          <div class="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/25 bg-brand-500/5 p-4">
            <button type="button" id="plate-lookup" class="inline-flex items-center gap-2 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-2 text-xs font-semibold text-brand-100 hover:bg-brand-500/25">
              ${icon('sparkles', 'w-4 h-4')} Buscar dados da placa
            </button>
            <button type="button" id="fipe-lookup" class="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">
              ${icon('info', 'w-4 h-4')} Consultar FIPE (marca + modelo)
            </button>
            <span class="text-[11px] text-slate-500">Consulta feita no cadastro de veículos da oficina. Se a placa não estiver cadastrada, preencha os dados manualmente.</span>
          </div>
          <div id="lookup-info" class="mt-3 hidden rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300"></div>` : ''}
        ${entity === 'fornecedores' ? `
          <div class="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/25 bg-brand-500/5 p-4">
            <button type="button" id="cnpj-lookup" class="inline-flex items-center gap-2 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-2 text-xs font-semibold text-brand-100 hover:bg-brand-500/25">
              ${icon('sparkles', 'w-4 h-4')} Buscar CNPJ
            </button>
            <span class="text-[11px] text-slate-500">A consulta preenche razão social, contato, país, telefone e e-mail quando disponíveis, além de situação e endereço nas observações.</span>
          </div>
          <div id="lookup-info" class="mt-3 hidden rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300" role="status" aria-live="polite"></div>` : ''}
        <div class="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-5">
          <button type="button" data-close-form class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancelar</button>
          <button type="submit" class="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-400">${row ? 'Salvar alterações' : 'Cadastrar'}</button>
        </div>
      </form>`, 'max-w-4xl');

    const form = modal.element.querySelector<HTMLFormElement>('#crud-form')!;
    modal.element.querySelector('[data-close-form]')?.addEventListener('click', modal.close);

    // Cobre clientes, mecânicos e fornecedores (todos usam o mesmo campo "telefone").
    setupPhoneFields(form);

    const validateClient = entity === 'clientes'
      ? setupClientForm(form, modal.element, row)
      : undefined;
    const validateNotification = entity === 'notificacoes'
      ? setupNotificationForm(form, modal.element, row)
      : undefined;
    const validateEmail = setupEmailField(form, meta.fields);
    const validateSupplier = entity === 'fornecedores'
      ? setupSupplierCnpj(form, modal.element, row?.cnpj)
      : undefined;

    if (entity === 'veiculos') {
      modal.element.querySelector('#plate-lookup')?.addEventListener('click', async () => {
        const plate = form.querySelector<HTMLInputElement>('[name="placa"]')!.value;
        if (!plate.trim()) return toast('Digite a placa antes de buscar.', 'error');
        const response = await window.oficina.plate(plate);
        if (!response.ok) return toast(response.error!, 'error');
        const result = response.data!;
        const info = modal.element.querySelector<HTMLElement>('#lookup-info')!;
        const showInfo = (message: string) => {
          info.textContent = message;
          info.classList.remove('hidden');
        };
        info.classList.add('hidden');
        info.textContent = '';
        switch (result.status) {
          case 'invalid':
            toast(result.message, 'error');
            return;
          case 'not_found':
          case 'unavailable':
            showInfo(result.message);
            toast(result.message, 'info');
            return;
          case 'found': {
            const data = result.data;
            const set = (key: string, value: unknown) => {
              const input = form.querySelector<HTMLInputElement>(`[name="${key}"]`);
              if (input) input.value = value === null || value === undefined ? '' : String(value);
            };
            set('placa', data.placa);
            set('marca', data.marca);
            set('modelo', data.modelo);
            set('ano_fabricacao', data.anoFabricacao);
            set('ano_modelo', data.anoModelo);
            set('cor', data.cor);
            set('combustivel', data.combustivel);
            set('chassi', data.chassi);
            showInfo('Dados obtidos do cadastro de veículos da oficina.');
            toast('Dados do veículo preenchidos.', 'success');
            return;
          }
        }
      });

      modal.element.querySelector('#fipe-lookup')?.addEventListener('click', async () => {
        const marca = form.querySelector<HTMLInputElement>('[name="marca"]')!.value;
        const modelo = form.querySelector<HTMLInputElement>('[name="modelo"]')!.value;
        if (!marca && !modelo) return toast('Informe marca ou modelo para consultar a FIPE.', 'error');
        const response = await window.oficina.fipe(marca, modelo);
        if (!response.ok) return toast(response.error!, 'error');
        const items = response.data!;
        const info = modal.element.querySelector<HTMLElement>('#lookup-info')!;
        info.classList.remove('hidden');
        info.innerHTML = items.length
          ? `<strong class="mb-2 block text-slate-100">Preço FIPE — ${escapeHTML(items[0].referencia)} (fonte: Preço FIPE)</strong>` +
            items.slice(0, 4).map((v) => `<div class="flex justify-between gap-4 border-t border-slate-800 py-1.5"><span>${escapeHTML(v.marca)} ${escapeHTML(v.modelo)} (${escapeHTML(v.anoMin)}-${escapeHTML(v.anoMax)})</span><span class="text-emerald-300">${escapeHTML(money(v.precoMin))} – ${escapeHTML(money(v.precoMax))}</span></div>`).join('')
          : 'Nenhum veículo encontrado na Tabela FIPE.';
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (validateClient && !validateClient()) return;
      if (validateNotification && !validateNotification()) return;
      if (validateEmail && !validateEmail()) return;
      if (validateSupplier && !validateSupplier()) return;
      const data = readForm(form, meta.fields);
      if (entity === 'notificacoes') {
        const canal = normalizeChannel(data.canal);
        if (canal) data.canal = canal;
      }
      const error = validateForm(meta.fields, data);
      if (error) return toast(error, 'error');
      const response = row
        ? await window.oficina.update(entity, row.id, data)
        : entity === 'notificacoes'
          ? await window.oficina.createNotification(data)
          : await window.oficina.create(entity, data);
      if (!response.ok) return toast(response.error!, 'error');
      modal.close();
      if (entity === 'notificacoes' && !row) {
        const msg = data.canal === 'WhatsApp'
          ? 'Aviso salvo. WhatsApp aberto — confirme o envio no app.'
          : data.canal === 'SMS'
            ? 'Aviso salvo. App de SMS aberto — envie a mensagem lá.'
            : 'Aviso salvo. App de e-mail aberto — envie a mensagem lá.';
        toast(msg, 'info');
      } else {
        toast(row ? 'Alterações salvas.' : 'Registro cadastrado com sucesso.');
      }
      reload();
      opts.onSaved?.();
    });
  }

  await reload();
}
