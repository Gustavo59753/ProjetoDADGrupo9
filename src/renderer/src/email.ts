import type { FieldDef } from '@shared/types';
import { isValidEmail } from '@shared/validation';
import { toast } from './ui';

/** Evita registrar mais de um listener no mesmo input (ex.: reabertura do modal). */
const boundEmails = new WeakSet<HTMLInputElement>();

/**
 * Valida o campo de e-mail dos cadastros que o possuem (clientes, mecânicos e
 * fornecedores). O campo é opcional: vazio passa e `validateForm` cuida de `required`.
 * Retorna `undefined` quando o formulário não tem esse campo.
 */
export function setupEmailField(form: HTMLFormElement, fields: FieldDef[]): (() => boolean) | undefined {
  if (!fields.some((field) => field.key === 'email')) return undefined;

  const input = form.querySelector<HTMLInputElement>('[name="email"]');
  if (!input) return () => true;

  if (!boundEmails.has(input)) {
    boundEmails.add(input);
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  }

  return function validateEmailField(): boolean {
    const value = input.value.trim();
    if (!value || isValidEmail(value)) {
      input.removeAttribute('aria-invalid');
      return true;
    }
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    toast('Informe um e-mail com domínio e extensão (ex.: cliente@gmail.com).', 'error');
    return false;
  };
}
