import { renderEmail } from './templates';
import { escapeHtml } from './templates/layout';

describe('templates de e-mail', () => {
  it('renderiza mudança de status com nota final', () => {
    const email = renderEmail({
      template: 'submission-status-changed',
      to: 'ana@furg.br',
      data: {
        recipientName: 'Ana',
        submissionTitle: 'Robótica educacional',
        eventName: 'MEPERG 2026',
        status: 'APPROVED',
        finalGrade: 8.5,
      },
    });

    expect(email.subject).toBe('[MEPERG 2026] Aprovado: Robótica educacional');
    expect(email.text).toContain('Nota final: 8.50.');
    expect(email.text).toContain('certificado');
  });

  it('escapa HTML vindo de dados do usuário', () => {
    const email = renderEmail({
      template: 'submission-received',
      to: 'a@b.com',
      data: { recipientName: '<script>x</script>', submissionTitle: 'T', eventName: 'E' },
    });
    expect(email.html).not.toContain('<script>');
    expect(escapeHtml('"&"')).toBe('&quot;&amp;&quot;');
  });
});
