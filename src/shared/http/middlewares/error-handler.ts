import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AppError } from '../errors';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function send(res: Response, status: number, code: string, message: string, details?: unknown) {
  const body: ErrorBody = { error: { code, message, ...(details !== undefined && { details }) } };
  res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response) {
  send(res, 404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${req.path} não existe`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return send(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return send(res, 400, 'VALIDATION_ERROR', 'Dados inválidos', details);
  }

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return send(res, 413, 'FILE_TOO_LARGE', `Arquivo excede o limite de ${env.MAX_UPLOAD_MB} MB`);
    }
    return send(res, 400, 'UPLOAD_ERROR', err.message);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(res, 409, 'CONFLICT', 'Registro duplicado', err.meta);
    if (err.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Registro não encontrado');
  }

  // corpo JSON malformado (express.json)
  if (err instanceof SyntaxError && 'body' in err) {
    return send(res, 400, 'INVALID_JSON', 'JSON malformado');
  }

  logger.error({ err }, 'Erro não tratado');
  send(res, 500, 'INTERNAL_ERROR', 'Erro interno do servidor');
}
