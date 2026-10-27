import PDFDocument from 'pdfkit';

export interface CertificateData {
  authors: string[];
  submissionTitle: string;
  area: string;
  eventName: string;
  finalGrade: number | null;
  issuedAt: Date;
  verificationCode: string;
  verificationUrl: string;
}

function formatAuthors(authors: string[]): string {
  if (authors.length <= 1) return authors.join('');
  return `${authors.slice(0, -1).join(', ')} e ${authors[authors.length - 1]}`;
}

/** Gera o certificado (A4 paisagem) e devolve o PDF em memória */
export function renderCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 60,
      info: { Title: `Certificado — ${data.submissionTitle}`, Author: data.eventName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, height } = doc.page;
    doc.lineWidth(3).strokeColor('#1f4e79').rect(25, 25, width - 50, height - 50).stroke();
    doc.lineWidth(1).rect(35, 35, width - 70, height - 70).stroke();

    doc.moveDown(2).font('Helvetica-Bold').fontSize(36).fillColor('#1f4e79').text('CERTIFICADO', { align: 'center' });
    doc.moveDown(1.5);

    const plural = data.authors.length > 1;
    doc
      .font('Helvetica')
      .fontSize(16)
      .fillColor('#222222')
      .text(
        `Certificamos que ${formatAuthors(data.authors)} ${plural ? 'apresentaram' : 'apresentou'} o trabalho`,
        { align: 'center' },
      );
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(20).text(`"${data.submissionTitle}"`, { align: 'center' });
    doc
      .moveDown(0.6)
      .font('Helvetica')
      .fontSize(16)
      .text(`na área de ${data.area}, aprovado no evento ${data.eventName}.`, { align: 'center' });

    if (data.finalGrade !== null) {
      doc.moveDown(0.4).fontSize(13).fillColor('#555555').text(`Nota final: ${data.finalGrade.toFixed(2)}`, {
        align: 'center',
      });
    }

    const issued = data.issuedAt.toLocaleDateString('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' });
    doc
      .fontSize(10)
      .fillColor('#555555')
      .text(`Emitido em ${issued}`, 60, height - 120, { align: 'center', width: width - 120 })
      .text(`Código de verificação: ${data.verificationCode}`, { align: 'center', width: width - 120 })
      .text(`Verifique a autenticidade em ${data.verificationUrl}`, { align: 'center', width: width - 120 });

    doc.end();
  });
}
