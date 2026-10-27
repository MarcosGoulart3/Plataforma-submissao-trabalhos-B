import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Envia um PDF do storage como download, fazendo streaming (sem carregar tudo em memória) */
export async function sendPdf(res: Response, stream: Readable, fileName: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  await pipeline(stream, res);
}
