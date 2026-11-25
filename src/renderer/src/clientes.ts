import type { PersonType } from '@shared/types';
import { maskPhone } from '@shared/validation';
import { bindInputMask, bindPhoneMask } from './phone';
import { toast } from './ui';

type Row = Record<string, any>;
type AlertKind = 'error' | 'info';
type BlockField = 'cep' | 'documento';
type AlertOwner = BlockField | 'info' | null;

const CPF_MASK = '000.000.000-00';
const CNPJ_MASK = '00.000.000/0000-00';
const CPF_HINT = 'CPF com 11 dígitos. Os dígitos são validados no cadastro.';
const CNPJ_HINT = 'CNPJ com 14 dígitos. Os dígitos são validados no cadastro e os dados da empresa são consultados na Minha Receita.';
const LOOKUP_DELAY = 350;

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function maskCep(value: string): string {
  const d = digits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function maskDocument(value: string, person: PersonType): string {
  const d = digits(value).slice(0, person === 'PJ' ? 14 : 11);
  if (person !== 'PJ') {
    let out = d.slice(0, 3);
    if (d.length > 3) out += `.${d.slice(3, 6)}`;
    if (d.length > 6) out += `.${d.slice(6, 9)}`;
    if (d.length > 9) out += `-${d.slice(9, 11)}`;
    return out;
  }
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 5)}`;
  if (d.length > 5) out += `.${d.slice(5, 8)}`;
  if (d.length > 8) out += `/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12, 14)}`;
  return out;
}

/**
 * Configura máscaras, consultas automáticas e validação local do formulário de clientes.
 * Retorna o validador que deve ser chamado no submit, antes de readForm/validateForm.
 */
export function setupClientForm(form: HTMLFormElement, root: HTMLElement, row?: Row): () => boolean {
  const field = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name: string): T | null =>
    form.querySelector<T>(`[name="${name}"]`);

  const typeSelect = field<HTMLSelectElement>('tipo_pessoa');
  const cepInput = field<HTMLInputElement>('cep');
  const docInput = field<HTMLInputElement>('cpf_cnpj');
  const phoneInput = field<HTMLInputElement>('telefone');
  const docLabel = form.querySelector<HTMLElement>('label[for="f_cpf_cnpj"]');
  let docHint = docInput?.closest('div')?.querySelector<HTMLElement>('p') ?? null;

  // Preserva o valor digitado para cada tipo: alternar PF <-> PJ não deve truncar o documento.
  const initialPerson: PersonType = row?.tipo_pessoa === 'PJ' ? 'PJ' : 'PF';
  let currentPerson: PersonType = initialPerson;
  const docValues: Record<PersonType, string> = { PF: '', PJ: '' };
  if (docInput) docValues[initialPerson] = docInput.value;

  const alertEl = document.createElement('div');
  alertEl.id = 'client-lookup-alert';
  alertEl.className = 'mb-4 hidden rounded-lg border px-3 py-2.5 text-sm leading-5';
  alertEl.setAttribute('role', 'status');
  alertEl.setAttribute('aria-live', 'polite');
  (root.querySelector<HTMLElement>('.modal-body') ?? form).prepend(alertEl);

  const blocks: Record<BlockField, string | null> = { cep: null, documento: null };
  let alertOwner: AlertOwner = null;
  /** Erro de bloqueio exibido: enquanto existir, avisos informativos não o substituem. */
  let blockingMessage: string | null = null;

  function syncBlockingMessage(): void {
    blockingMessage = blocks.cep ?? blocks.documento ?? null;
  }

  function showAlert(message: string, kind: AlertKind): void {
    if (kind === 'info' && blockingMessage) return;
    if (kind === 'error') blockingMessage = message;
    alertEl.textContent = message;
    alertEl.className = `mb-4 rounded-lg border px-3 py-2.5 text-sm leading-5 ${
      kind === 'error'
        ? 'border-rose-500/40 bg-rose-950/60 text-rose-200'
        : 'border-sky-500/40 bg-sky-950/60 text-sky-200'
    }`;
    // Erro usa role="alert"; informação usa role="status" com aria-live="polite".
    if (kind === 'error') {
      alertEl.setAttribute('role', 'alert');
      alertEl.removeAttribute('aria-live');
    } else {
      alertEl.setAttribute('role', 'status');
      alertEl.setAttribute('aria-live', 'polite');
    }
    alertEl.classList.remove('hidden');
  }

  function hideAlert(): void {
    alertEl.classList.add('hidden');
    alertEl.textContent = '';
    alertOwner = null;
    blockingMessage = null;
  }

  /** Esconde apenas um aviso informativo, preservando eventual erro de bloqueio. */
  function clearInfoAlert(): void {
    if (alertOwner === 'info') hideAlert();
  }

  function block(fieldName: BlockField, message: string, input?: HTMLInputElement | null): void {
    blocks[fieldName] = message;
    input?.setAttribute('aria-invalid', 'true');
    alertOwner = fieldName;
    syncBlockingMessage();
    showAlert(message, 'error');
  }

  function unblock(fieldName: BlockField, input?: HTMLInputElement | null): void {
    blocks[fieldName] = null;
    input?.removeAttribute('aria-invalid');
    syncBlockingMessage();
    if (blockingMessage) {
      // Ainda existe erro em outro campo: ele continua tendo prioridade na tela.
      alertOwner = blocks.cep ? 'cep' : 'documento';
      showAlert(blockingMessage, 'error');
      return;
    }
    hideAlert();
  }

  /** Aviso informativo (API indisponível / não encontrada): nunca bloqueia o cadastro. */
  function notify(message: string): void {
    if (!blockingMessage) {
      alertOwner = 'info';
      showAlert(message, 'info');
    }
    toast(message, 'info');
  }

  /** Único ponto de escrita nos campos preenchidos pelas consultas. */
  function setField(name: string, value: unknown): void {
    const input = field<HTMLInputElement>(name);
    if (input) input.value = value === null || value === undefined ? '' : String(value);
  }

  /** Preenche somente campos vazios: o que o usuário digitou nunca é sobrescrito. */
  function setFieldIfEmpty(name: string, value: unknown): void {
    const input = field<HTMLInputElement>(name);
    if (input && !input.value.trim()) setField(name, value);
  }

  function personType(): PersonType {
    return typeSelect?.value === 'PJ' ? 'PJ' : 'PF';
  }

  function applyPersonType(person: PersonType, remask: boolean): void {
    if (docInput && remask && person !== currentPerson) {
      docValues[currentPerson] = docInput.value;
      docInput.value = docValues[person];
    }
    currentPerson = person;
    if (docLabel) docLabel.textContent = person === 'PJ' ? 'CNPJ' : 'CPF';
    if (docInput) {
      docInput.placeholder = person === 'PJ' ? CNPJ_MASK : CPF_MASK;
      if (remask) docInput.value = maskDocument(docInput.value, person);
    }
    if (!docHint && docInput) {
      docHint = document.createElement('p');
      docHint.className = 'mt-1.5 text-[11px] leading-4 text-slate-500';
      docInput.parentElement?.appendChild(docHint);
    }
    if (docHint) docHint.textContent = person === 'PJ' ? CNPJ_HINT : CPF_HINT;
  }

  let cepTimer: number | undefined;
  let cnpjTimer: number | undefined;
  let cepSeq = 0;
  let cnpjSeq = 0;
  let lastCep = '';
  let lastCnpj = '';

  async function lookupCep(value: string): Promise<void> {
    const d = digits(value);
    if (d.length !== 8 || d === lastCep) return;
    lastCep = d;
    const seq = ++cepSeq;
    let response;
    try {
      response = await window.oficina.cep(d);
    } catch {
      if (seq === cepSeq) notify('Não foi possível consultar o CEP. Preencha o endereço manualmente.');
      return;
    }
    if (seq !== cepSeq) return;
    if (!response.ok) {
      notify(response.error ?? 'Não foi possível consultar o CEP. Preencha o endereço manualmente.');
      return;
    }
    const result = response.data!;
    switch (result.status) {
      case 'invalid':
        block('cep', result.message, cepInput);
        toast(result.message, 'error');
        return;
      case 'not_found':
      case 'unavailable':
        // CEP inexistente ou serviço fora apenas avisa: o endereço pode ser digitado manualmente.
        notify(result.message);
        return;
      case 'found': {
        unblock('cep', cepInput);
        clearInfoAlert();
        setFieldIfEmpty('endereco', [result.data.logradouro, result.data.bairro].filter(Boolean).join(', '));
        setFieldIfEmpty('cidade', result.data.localidade);
        setFieldIfEmpty('uf', result.data.uf);
        // Máscara é apenas formatação: aplicada ao próprio CEP, sem trocar os dígitos.
        const currentCep = cepInput?.value || result.data.cep || d;
        setField('cep', maskCep(currentCep));
        cepSeq++;
        clearTimeout(cepTimer);
        lastCep = digits(currentCep);
        toast('Endereço preenchido via ViaCEP.', 'success');
        return;
      }
    }
  }

  async function lookupCnpj(value: string): Promise<void> {
    const d = digits(value);
    if (personType() !== 'PJ' || d.length !== 14 || d === lastCnpj) return;
    lastCnpj = d;
    const seq = ++cnpjSeq;
    let response;
    try {
      response = await window.oficina.cnpj(d);
    } catch {
      if (seq === cnpjSeq) notify('Não foi possível consultar o CNPJ na Minha Receita. Preencha os dados manualmente.');
      return;
    }
    if (seq !== cnpjSeq || personType() !== 'PJ') return;
    if (!response.ok) {
      notify(response.error ?? 'Não foi possível consultar o CNPJ na Minha Receita. Preencha os dados manualmente.');
      return;
    }
    const result = response.data!;
    switch (result.status) {
      case 'invalid':
        block('documento', result.message, docInput);
        toast(result.message, 'error');
        return;
      case 'not_found':
      case 'unavailable':
        notify(result.message);
        return;
      case 'found': {
        unblock('documento', docInput);
        unblock('cep', cepInput);
        clearInfoAlert();
        const data = result.data;
        setFieldIfEmpty('nome', data.razao_social || data.nome_fantasia);
        setFieldIfEmpty('endereco', [data.logradouro, data.bairro].filter(Boolean).join(', '));
        setFieldIfEmpty('cidade', data.cidade);
        setFieldIfEmpty('uf', data.uf);
        setFieldIfEmpty('numero', data.numero);
        // CEP já preenchido recebe só a máscara visual; se vazio, vem da API e também é mascarado.
        setFieldIfEmpty('cep', data.cep);
        if (cepInput) setField('cep', maskCep(cepInput.value));
        if (docInput) docInput.value = maskDocument(docInput.value, 'PJ');
        cepSeq++;
        clearTimeout(cepTimer);
        lastCep = digits(cepInput?.value ?? data.cep);
        toast('Dados da empresa preenchidos via Minha Receita.', 'success');
        return;
      }
    }
  }

  // Estado inicial (criação ou edição): rótulos, hints e máscaras dos valores já presentes.
  applyPersonType(initialPerson, true);
  if (cepInput) cepInput.value = maskCep(cepInput.value);
  if (phoneInput) phoneInput.value = maskPhone(phoneInput.value);

  typeSelect?.addEventListener('change', () => {
    applyPersonType(personType(), true);
    cnpjSeq++;
    clearTimeout(cnpjTimer);
    cnpjTimer = undefined;
    lastCnpj = '';
    unblock('documento', docInput);
    clearInfoAlert();
    if (personType() === 'PJ' && docInput && digits(docInput.value).length === 14) {
      void lookupCnpj(docInput.value);
    }
  });

  if (cepInput) {
    bindInputMask(cepInput, maskCep, () => {
      unblock('cep', cepInput);
      clearInfoAlert();
      cepSeq++;
      clearTimeout(cepTimer);
      lastCep = '';
      const d = digits(cepInput.value);
      if (d.length === 8) cepTimer = window.setTimeout(() => void lookupCep(d), LOOKUP_DELAY);
    });
    cepInput.addEventListener('blur', () => {
      clearTimeout(cepTimer);
      const d = digits(cepInput.value);
      if (d.length === 8) void lookupCep(d);
    });
  }

  if (docInput) {
    bindInputMask(docInput, (value) => maskDocument(value, personType()), () => {
      unblock('documento', docInput);
      clearInfoAlert();
      cnpjSeq++;
      clearTimeout(cnpjTimer);
      lastCnpj = '';
      if (personType() === 'PJ' && digits(docInput.value).length === 14) {
        const d = digits(docInput.value);
        cnpjTimer = window.setTimeout(() => void lookupCnpj(d), LOOKUP_DELAY);
      }
    });
    docInput.addEventListener('blur', () => {
      clearTimeout(cnpjTimer);
      if (personType() !== 'PJ') return;
      const d = digits(docInput.value);
      if (d.length === 14) void lookupCnpj(d);
    });
  }

  // Listener único: o CRUD já aplica bindPhoneMask ao campo; WeakSet evita duplicar.
  if (phoneInput) bindPhoneMask(phoneInput);

  /** Validação local de formato/comprimento; a checksum é responsabilidade do backend. */
  return function validateClientForm(): boolean {
    syncBlockingMessage();
    const cepDigits = cepInput ? digits(cepInput.value) : '';
    if (!cepDigits) {
      unblock('cep', cepInput);
    } else if (cepDigits.length !== 8) {
      block('cep', 'Informe um CEP válido com 8 dígitos (00000-000).', cepInput);
    } else if (blocks.cep) {
      cepInput?.setAttribute('aria-invalid', 'true');
    }

    const docDigits = docInput ? digits(docInput.value) : '';
    const person = personType();
    const expected = person === 'PJ' ? 14 : 11;
    if (!docDigits) {
      unblock('documento', docInput);
    } else if (docDigits.length !== expected) {
      block('documento', person === 'PJ'
        ? 'Informe um CNPJ válido com 14 dígitos (00.000.000/0000-00).'
        : 'Informe um CPF válido com 11 dígitos (000.000.000-00).', docInput);
    } else if (blocks.documento) {
      docInput?.setAttribute('aria-invalid', 'true');
    }

    const message = blocks.cep ?? blocks.documento;
    if (!message) {
      cepInput?.removeAttribute('aria-invalid');
      docInput?.removeAttribute('aria-invalid');
      return true;
    }
    alertOwner = blocks.cep ? 'cep' : 'documento';
    (blocks.cep ? cepInput : docInput)?.focus();
    showAlert(message, 'error');
    toast(message, 'error');
    return false;
  };
}
