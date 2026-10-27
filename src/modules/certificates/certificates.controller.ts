import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../../shared/http/middlewares/authenticate';
import { sendPdf } from '../../shared/http/send-file';
import { certificatesService } from './certificates.service';

const idParams = z.object({ id: z.uuid() });
const codeParams = z.object({ code: z.string().min(4).max(32) });

export const certificatesController = {
  async listMine(req: Request, res: Response) {
    res.json(await certificatesService.listMine(currentUser(req)));
  },

  async download(req: Request, res: Response) {
    const { id } = idParams.parse(req.params);
    const { stream, fileName } = await certificatesService.openFile(currentUser(req), id);
    await sendPdf(res, stream, fileName);
  },

  async verify(req: Request, res: Response) {
    const { code } = codeParams.parse(req.params);
    res.json(await certificatesService.verify(code));
  },
};
