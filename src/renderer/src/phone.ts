import { maskPhone } from '@shared/validation';

/** Mesmo critério usado pelas máscaras de CEP/documento: só dígitos contam para o caret. */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Evita registrar mais de um listener de telefone no mesmo input (ex.: clientes + CRUD). */
const boundPhones = new WeakSet<HTMLInputElement>();

/**
 * Aplica `format` enquanto o usuário digita, preservando o caret pela quantidade
 * de dígitos antes dele. `enabled` permite desligar temporariamente a máscara
 * (canal E-mail dos avisos) sem remover o listener; `after` sempre é chamado.
 */
export function bindInputMask(
  input: HTMLInputElement,
  format: (value: string) => string,
  after?: () => void,
  enabled?: () => boolean,
): void {
  input.addEventListener('input', () => {
    if (!enabled || enabled()) {
      const caret = input.selectionStart ?? input.value.length;
      const digitsBeforeCaret = digits(input.value.slice(0, caret)).length;
      const formatted = format(input.value);
      if (formatted !== input.value) {
        input.value = formatted;
        let seen = 0;
        let position = formatted.length;
        for (let i = 0; i < formatted.length; i++) {
          if (/\d/.test(formatted[i])) {
            seen++;
            if (seen === digitsBeforeCaret) {
              position = i + 1;
              break;
            }
          }
        }
        if (digitsBeforeCaret === 0) position = formatted.startsWith('(') ? 1 : 0;
        input.setSelectionRange(position, position);
      }
    }
    after?.();
  });
}

/** Máscara de telefone reutilizável; formata também o valor já presente no input. */
export function bindPhoneMask(input: HTMLInputElement | null, enabled?: () => boolean): void {
  if (!input || boundPhones.has(input)) return;
  boundPhones.add(input);
  if (!enabled || enabled()) input.value = maskPhone(input.value);
  bindInputMask(input, maskPhone, undefined, enabled);
}

/** Aplica a máscara a todos os campos `telefone` do modal genérico (clientes, mecânicos, fornecedores). */
export function setupPhoneFields(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[name="telefone"]').forEach((input) => bindPhoneMask(input));
}
