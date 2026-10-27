import type { Role } from '@prisma/client';
import {
  AppError,
  BadRequestError,
  BusinessRuleError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../shared/http/errors';
import {
  CepNotFoundError,
  InvalidCepError,
  viaCep,
  ViaCepUnavailableError,
  type CepAddress,
} from '../../shared/infra/viacep';
import { normalizeCep } from '../../shared/utils/cep';
import { logger } from '../../shared/utils/logger';
import { mergeAddress } from './address';
import type { AddressInput } from './users.schemas';
import { usersRepository } from './users.repository';

export const usersService = {
  async getProfile(userId: string) {
    const profile = await usersRepository.findProfile(userId);
    if (!profile) throw new NotFoundError('Usuário');
    return profile;
  },

  updateProfile(userId: string, data: { name: string }) {
    return usersRepository.update(userId, data);
  },

  /** Consulta usada pelo front para autopreencher o formulário; o complemento fica para o usuário */
  async lookupCep(rawCep: string): Promise<CepAddress & { complement: null }> {
    try {
      return { ...(await viaCep.lookup(rawCep)), complement: null };
    } catch (err) {
      throw mapViaCepError(err);
    }
  },

  /**
   * Salva o endereço completando os campos pelo CEP.
   * Degradação graciosa: se o ViaCEP estiver fora do ar ou não conhecer o CEP
   * (ex.: CEP novo), aceita o endereço desde que o usuário tenha informado
   * todos os campos manualmente.
   */
  async saveAddress(userId: string, input: AddressInput) {
    const cep = normalizeCep(input.cep);
    if (!cep) throw new BadRequestError('CEP inválido: informe 8 dígitos');

    let fromViaCep: CepAddress | null = null;
    let lookupError: CepNotFoundError | ViaCepUnavailableError | null = null;
    try {
      fromViaCep = await viaCep.lookup(cep);
    } catch (err) {
      if (!(err instanceof ViaCepUnavailableError || err instanceof CepNotFoundError)) throw mapViaCepError(err);
      lookupError = err;
      logger.warn({ err, cep }, 'CEP sem retorno do ViaCEP; tentando salvar endereço informado manualmente');
    }

    const { address, missing } = mergeAddress(cep, input, fromViaCep);
    if (missing.length > 0) {
      const fields = missing.join(', ');
      if (lookupError instanceof CepNotFoundError) {
        throw new AppError(404, 'CEP_NOT_FOUND', `${lookupError.message}. Informe manualmente: ${fields}`, { missing });
      }
      if (lookupError) {
        throw new ServiceUnavailableError(`Não foi possível consultar o CEP agora. Informe manualmente: ${fields}`);
      }
      throw new BusinessRuleError('ADDRESS_INCOMPLETE', `Informe os campos: ${fields}`, { missing });
    }

    return usersRepository.upsertAddress(userId, address);
  },

  list(filter: { role?: Role; search?: string }) {
    return usersRepository.list(filter);
  },

  async updateRoles(userId: string, roles: Role[]) {
    const user = await usersRepository.findById(userId);
    if (!user) throw new NotFoundError('Usuário');
    return usersRepository.update(userId, { roles: { set: roles } });
  },
};

function mapViaCepError(err: unknown): Error {
  if (err instanceof InvalidCepError) return new BadRequestError(err.message);
  if (err instanceof CepNotFoundError) return new AppError(404, 'CEP_NOT_FOUND', err.message);
  if (err instanceof ViaCepUnavailableError) {
    return new ServiceUnavailableError('Consulta de CEP indisponível no momento; preencha o endereço manualmente');
  }
  return err as Error;
}
