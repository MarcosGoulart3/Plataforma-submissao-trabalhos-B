import type { Job } from 'pg-boss';
import { certificatesService } from '../modules/certificates/certificates.service';
import type { GenerateCertificatePayload } from '../shared/infra/queue/jobs';
import { logger } from '../shared/utils/logger';

export async function handleCertificateJobs(jobs: Job<GenerateCertificatePayload>[]): Promise<void> {
  for (const job of jobs) {
    const certificate = await certificatesService.issueForSubmission(job.data.submissionId);
    if (certificate) {
      logger.info({ jobId: job.id, certificateId: certificate.id }, 'Certificado emitido');
    }
  }
}
