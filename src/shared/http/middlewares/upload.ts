import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { env } from '../../config/env';
import { BadRequestError } from '../errors';

const PDF_MAGIC = Buffer.from('%PDF-');

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

const multerPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return cb(new BadRequestError('Somente arquivos PDF são aceitos'));
    cb(null, true);
  },
});

/** Confere a assinatura do arquivo: mimetype/extensão vêm do cliente e podem mentir */
function checkPdfSignature(req: Request, _res: Response, next: NextFunction) {
  if (req.file && !isPdfBuffer(req.file.buffer)) {
    throw new BadRequestError('O conteúdo do arquivo não é um PDF válido');
  }
  next();
}

/** Upload de um único PDF (opcional na rota; o service decide se é obrigatório) */
export function uploadPdf(field: string) {
  return [multerPdf.single(field), checkPdfSignature];
}
