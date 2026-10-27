import type { CepAddress } from '../../shared/infra/viacep';
import type { AddressInput } from './users.schemas';

export interface CompleteAddress {
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

const REQUIRED = ['street', 'neighborhood', 'city', 'state'] as const;

/**
 * Combina o que o usuário digitou com o retorno do ViaCEP (função pura).
 * O valor digitado prevalece; o ViaCEP preenche o que faltar. `viaCep` é null
 * quando a API está indisponível — nesse caso tudo precisa ter sido informado.
 * Retorna os campos que continuam faltando.
 */
export function mergeAddress(
  cep: string,
  input: AddressInput,
  viaCep: CepAddress | null,
): { address: CompleteAddress; missing: string[] } {
  const pick = (field: (typeof REQUIRED)[number]) => input[field] || viaCep?.[field] || '';

  const address: CompleteAddress = {
    cep,
    street: pick('street'),
    number: input.number,
    // o "complemento" do ViaCEP descreve a faixa do CEP ("lado ímpar", "até 999/1000"),
    // não o endereço do usuário: o complemento vem só do que ele digitou
    complement: input.complement || null,
    neighborhood: pick('neighborhood'),
    city: pick('city'),
    state: pick('state'),
  };

  return { address, missing: REQUIRED.filter((field) => !address[field]) };
}
