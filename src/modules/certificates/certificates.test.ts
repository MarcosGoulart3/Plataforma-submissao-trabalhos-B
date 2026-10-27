import { isPdfBuffer } from '../../shared/http/middlewares/upload';
import { renderCertificatePdf } from './certificate.template';
import { generateVerificationCode } from './certificates.service';

describe('certificados', () => {
  it('gera um PDF válido', async () => {
    const pdf = await renderCertificatePdf({
      authors: ['Ana Autora', 'Bruno Coautor'],
      submissionTitle: 'Robótica educacional no ensino médio',
      area: 'Computação',
      eventName: 'MEPERG 2026',
      finalGrade: 9.25,
      issuedAt: new Date('2026-05-10T12:00:00Z'),
      verificationCode: 'ABCD-1234-EF56',
      verificationUrl: 'http://localhost:3333/certificates/verify/ABCD-1234-EF56',
    });

    expect(isPdfBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('código de verificação no formato XXXX-XXXX-XXXX e aleatório', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(generateVerificationCode()).not.toBe(code);
  });
});
