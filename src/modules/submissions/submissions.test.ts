import { BusinessRuleError, ForbiddenError } from '../../shared/http/errors';
import { isPdfBuffer } from '../../shared/http/middlewares/upload';
import type { AuthUser } from '../../shared/http/types';
import { assertCanEdit, viewerKind, type SubmissionAccessContext } from './submission.policy';
import { createSubmissionSchema, updateSubmissionSchema } from './submissions.schemas';
import type { SubmissionDetails } from './submissions.repository';
import { submissionRecipients } from './submissions.service';

const d = (iso: string) => new Date(iso);

const author: AuthUser = { id: 'author', name: 'Ana', email: 'ana@furg.br', roles: ['PARTICIPANT'] };
const coauthorUser: AuthUser = { id: 'co', name: 'Bruno', email: 'bruno@furg.br', roles: ['PARTICIPANT'] };
const reviewer: AuthUser = { id: 'rev', name: 'Rita', email: 'rita@furg.br', roles: ['REVIEWER'] };
const organizer: AuthUser = { id: 'org', name: 'Otto', email: 'otto@furg.br', roles: ['ORGANIZER'] };
const stranger: AuthUser = { id: 'x', name: 'Xis', email: 'x@furg.br', roles: ['PARTICIPANT'] };

const submission: SubmissionAccessContext = {
  authorId: 'author',
  status: 'SUBMITTED',
  coauthors: [{ email: 'bruno@furg.br', userId: null }],
  reviews: [{ reviewerId: 'rev' }],
  event: {
    organizerId: 'org',
    submissionStartsAt: d('2026-03-01T00:00:00Z'),
    submissionEndsAt: d('2026-04-01T00:00:00Z'),
    reviewStartsAt: d('2026-04-02T00:00:00Z'),
    reviewEndsAt: d('2026-05-01T00:00:00Z'),
    resultAt: d('2026-05-10T00:00:00Z'),
  },
};

const insideWindow = d('2026-03-15T00:00:00Z');
const afterWindow = d('2026-04-15T00:00:00Z');

describe('submission.policy — edição', () => {
  it('autor edita dentro do prazo', () => {
    expect(() => assertCanEdit(author, submission, insideWindow)).not.toThrow();
  });

  it('coautor não edita (só quem submeteu)', () => {
    expect(() => assertCanEdit(coauthorUser, submission, insideWindow)).toThrow(ForbiddenError);
  });

  it('organizador não edita o trabalho do autor', () => {
    expect(() => assertCanEdit(organizer, submission, insideWindow)).toThrow(ForbiddenError);
  });

  it('bloqueia edição fora do prazo', () => {
    expect(() => assertCanEdit(author, submission, afterWindow)).toThrow(BusinessRuleError);
  });

  it('bloqueia edição de trabalho já em avaliação', () => {
    expect(() => assertCanEdit(author, { ...submission, status: 'UNDER_REVIEW' }, insideWindow)).toThrow(
      /já está em avaliação/,
    );
  });
});

describe('submission.policy — visualização', () => {
  it('classifica quem está vendo', () => {
    expect(viewerKind(author, submission)).toBe('author');
    expect(viewerKind(coauthorUser, submission)).toBe('author'); // casa pelo e-mail
    expect(viewerKind(reviewer, submission)).toBe('reviewer');
    expect(viewerKind(organizer, submission)).toBe('manager');
    expect(viewerKind(stranger, submission)).toBeNull();
  });
});

describe('createSubmissionSchema', () => {
  it('aceita coautores como string JSON (multipart)', () => {
    const parsed = createSubmissionSchema.parse({
      title: 'Robótica na escola',
      area: 'Computação',
      coauthors: JSON.stringify([{ name: 'Bruno Silva', email: 'BRUNO@furg.br' }]),
    });
    expect(parsed.coauthors).toEqual([{ name: 'Bruno Silva', email: 'bruno@furg.br' }]);
  });

  it('edição parcial não zera os coautores', () => {
    expect(updateSubmissionSchema.parse({ title: 'Novo título do trabalho' })).not.toHaveProperty('coauthors');
  });

  it('rejeita coautores repetidos', () => {
    const result = createSubmissionSchema.safeParse({
      title: 'Robótica na escola',
      area: 'Computação',
      coauthors: [
        { name: 'Bruno Silva', email: 'b@furg.br' },
        { name: 'Bruno S.', email: 'b@furg.br' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('validação do upload', () => {
  it('reconhece a assinatura %PDF-', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(isPdfBuffer(Buffer.from('MZ\x90\x00 executável renomeado'))).toBe(false);
    expect(isPdfBuffer(Buffer.alloc(0))).toBe(false);
  });
});

describe('submissionRecipients', () => {
  it('um destinatário por pessoa, com o próprio nome, sem repetir e-mail', () => {
    const recipients = submissionRecipients({
      author: { id: 'ana-id', name: 'Ana', email: 'ana@furg.br' },
      coauthors: [
        { name: 'Bruno', email: 'bruno@furg.br' },
        { name: 'Ana de novo', email: 'ANA@furg.br' },
        { name: 'Davi', email: 'davi@furg.br' },
      ] as SubmissionDetails['coauthors'],
    });
    expect(recipients).toEqual([
      { name: 'Ana', email: 'ana@furg.br' },
      { name: 'Bruno', email: 'bruno@furg.br' },
      { name: 'Davi', email: 'davi@furg.br' },
    ]);
  });
});
