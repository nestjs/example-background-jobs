import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { JobsOptions, Queue } from 'bullmq';

export const EMAILS_QUEUE = 'emails';

// What each kind of job carries: ids, not the user's email address, which may change before the job runs.
export interface WelcomeJob {
  userId: string;
}
export interface DigestJob {
  userId: string;
  /** The UTC day, as YYYY-MM-DD. */
  day: string;
}

/** What makes an email unique: its job id, its row in `sent_emails`, and its idempotency key. */
export const welcomeKey = (userId: string) => `welcome-${userId}`;
export const digestKey = (userId: string, day: string) => `digest-${userId}-${day}`;

const jobOptions = {
  // 10 attempts, 2 s apart and doubling: the last one runs about 17 minutes after the first.
  attempts: 10,
  backoff: { type: 'exponential', delay: 2_000 },
  // Finished jobs stay for inspection, for a day if they completed and a week if they failed.
  // Without these, Redis keeps every job forever.
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} satisfies JobsOptions;

@Injectable()
export class EmailJobs {
  constructor(@InjectQueue(EMAILS_QUEUE) private readonly queue: Queue) {}

  async welcome(userId: string): Promise<void> {
    const data: WelcomeJob = { userId };
    // A job whose id exists already isn't added again.
    await this.queue.add('welcome', data, { ...jobOptions, jobId: welcomeKey(userId) });
  }

  async digests(day: string, userIds: string[]): Promise<void> {
    await this.queue.addBulk(
      userIds.map((userId) => ({
        name: 'digest',
        data: { userId, day } satisfies DigestJob,
        opts: { ...jobOptions, jobId: digestKey(userId, day) },
      })),
    );
  }
}
