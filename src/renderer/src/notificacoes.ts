import type { NotificationChannel } from '@shared/types';
import { isValidEmail, isValidPhone, maskPhone } from '@shared/validation';
import { bindPhoneMask } from './phone';
import { toast } from './ui';

const PHONE_PLACEHOLDER = '(19) 98184-8882';
const EMAIL_PLACEHOLDER = 'cliente@gmail.com';
const NEUTRAL_PLACEHOLDER = 'Informe o destino';
const PHONE_HINT = 'Informe DDD + telefone com 10 ou 11 dígitos. A máscara é aplicada automaticamente.';
const EMAIL_HINT = 'Informe o e-mail completo, com domínio e extensão (ex.: cliente@gmail.com).';
const NEUTRAL_HINT = 'Selecione o canal para definir o formato do destino.';

function isChannel(value: unknown): value is NotificationChannel {
  return value === 'WhatsApp' || value === 'SMS' || value === 'E-mail';
}

/**
 * Configura o formulário genérico de avisos: alterna placeholder/hint conforme o
 * canal, liga/desliga a máscara de telefone e valida o destino antes do submit.
 */
export function setupNotificationForm(
  form: HTMLFormElement,
  root: HTMLElement,
  row?: Record<string, any>,
): () => boolean {
  const channelField = form.querySelector<HTMLSelectElement>('[name="canal"]');
  const destinoField = form.querySelector<HTMLInputElement>('[name="destino"]');
  if (!channelField || !destinoField || !root.contains(destinoField)) return () => true;
  const select = channelField;
  const input = destinoField;

  // O modal genérico só cria o <p> de hint quando field.hint existe; criamos se necessário.
  let hint = input.closest('div')?.querySelector<HTMLElement>('p') ?? null;
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'mt-1.5 text-[11px] leading-4 text-slate-500';
    input.parentElement?.appendChild(hint);
  }
  const hintId = input.id ? `${input.id}-hint` : 'notification-destino-hint';
  hint.id = hintId;
  hint.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', hintId);

  let maskBound = false;
  let canalAtual: NotificationChannel | '' = '';

  function currentChannel(): NotificationChannel | '' {
    // O <option selected> do fieldHtml já reflete o registro na edição.
    const value: unknown = select.value;
    return isChannel(value) ? value : '';
  }

  /** `clearInvalid` só vale para troca de canal: na abertura preservamos o valor salvo. */
  function applyChannel(clearInvalid = false): void {
    const canal = currentChannel();
    canalAtual = canal;
    const phoneChannel = canal === 'WhatsApp' || canal === 'SMS';

    if (clearInvalid && canal && input.value.trim()) {
      const valid = canal === 'E-mail' ? isValidEmail(input.value) : isValidPhone(input.value);
      if (!valid) {
        input.value = '';
        input.removeAttribute('aria-invalid');
        input.focus();
        toast('Destino limpo: informe o formato do novo canal.', 'info');
      }
    }

    input.placeholder = phoneChannel
      ? PHONE_PLACEHOLDER
      : canal === 'E-mail' ? EMAIL_PLACEHOLDER : NEUTRAL_PLACEHOLDER;
    if (hint) {
      hint.textContent = phoneChannel
        ? PHONE_HINT
        : canal === 'E-mail' ? EMAIL_HINT : NEUTRAL_HINT;
    }

    if (!maskBound) {
      maskBound = true;
      // Bind único: a máscara só atua nos canais de telefone.
      bindPhoneMask(input, () => canalAtual === 'WhatsApp' || canalAtual === 'SMS');
    }
    if (phoneChannel && input.value) input.value = maskPhone(input.value);
  }

  // Apenas limpa o estado de erro; o listener da máscara é registrado uma única vez.
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  select.addEventListener('change', () => {
    select.removeAttribute('aria-invalid');
    applyChannel(true);
  });
  applyChannel();

  return function validateNotificationForm(): boolean {
    const canal = currentChannel();
    if (!canal) {
      select.setAttribute('aria-invalid', 'true');
      select.focus();
      toast('Selecione o canal do aviso.', 'error');
      return false;
    }
    select.removeAttribute('aria-invalid');

    const value = input.value.trim();
    const valid = canal === 'E-mail' ? isValidEmail(value) : isValidPhone(value);
    if (!valid) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      toast(canal === 'E-mail'
        ? 'Informe um e-mail com domínio e extensão (ex.: cliente@gmail.com).'
        : 'Informe um telefone válido com DDD (10 ou 11 dígitos).', 'error');
      return false;
    }
    input.removeAttribute('aria-invalid');
    return true;
  };
}
