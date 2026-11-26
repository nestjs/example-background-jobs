import { Processor, WorkerHost } from '@nestjs/bullmq';
import { MailError, Mailer } from '@nestjs/mail';
import { UnrecoverableError, type Job } from 'bullmq';
import { UsersRepository } from '../users/users.repository.js';
import { DigestMail } from './digest.mail.js';
import { DigestRepository } from './digest.repository.js';
import { digestKey, EMAILS_QUEUE, welcomeKey, type DigestJob, type WelcomeJob } from './email.jobs.js';
import { SentEmailsRepository } from './sent-emails.repository.js';
import { WelcomeMail } from './welcome.mail.js';

const sendOptions = (key: string) => ({
  // BullMQ retries the job: one attempt per run.
  retry: false as const,
  // A resend of the same email keeps its Message-ID.
  idempotencyKey: key,
  // Well under the 5-minute claim, so no send outlives it.
  signal: AbortSignal.timeout(60_000),
});

// Up to 5 jobs at once, in each process that runs the worker.
@Processor(EMAILS_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly mailer: Mailer,
    private readonly usersRepository: UsersRepository,
    private readonly digestRepository: DigestRepository,
    private readonly sentEmails: SentEmailsRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<string> {
    try {
      switch (job.name) {
        case 'welcome':
          return await this.welcome(job.data);
        case 'digest':
          return await this.digest(job.data);
        default:
          throw new UnrecoverableError(`Unknown job ${job.name}`);
      }
    } catch (error) {
      // A refused address won't be accepted on the next attempt: fail the job now.
      if (error instanceof MailError && error.permanent) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  private async welcome({ userId }: WelcomeJob) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      return 'user deleted';
    }
    const key = welcomeKey(userId);
    return this.sentEmails.sendOnce(key, userId, () =>
      this.mailer.send(WelcomeMail, { to: user.email, data: user, ...sendOptions(key) }),
    );
  }

  private async digest({ userId, day }: DigestJob) {
    const user = await this.usersRepository.findById(userId);
    const titles = await this.digestRepository.titlesOn(userId, day);
    if (!user || titles.length === 0) {
      return 'nothing to send';
    }
    const key = digestKey(userId, day);
    return this.sentEmails.sendOnce(key, userId, () =>
      this.mailer.send(DigestMail, { to: user.email, data: { day, titles }, ...sendOptions(key) }),
    );
  }
}
