import { Injectable, Logger } from '@nestjs/common';
import { OnOneInstance } from '@nestjs/locks';
import { Cron } from '@nestjs/schedule';
import { DigestRepository, utcDay } from './digest.repository.js';
import { EmailJobs } from './email.jobs.js';

@Injectable()
export class DigestScheduler {
  private readonly logger = new Logger(DigestScheduler.name);

  constructor(
    private readonly digestRepository: DigestRepository,
    private readonly emailJobs: EmailJobs,
  ) {}

  // Every evening at 18:00 UTC, on one instance of the application.
  @Cron(process.env.DIGEST_CRON ?? '0 18 * * *', { name: 'daily-digest', timeZone: 'UTC' })
  @OnOneInstance({ key: 'mail:daily-digest' })
  async enqueueDigests(): Promise<number> {
    const day = utcDay(new Date());
    const userIds = await this.digestRepository.authorsOn(day);
    // One job per user: a slow or failing send delays nobody else's digest.
    await this.emailJobs.digests(day, userIds);
    this.logger.log(`Digests of ${day}: ${userIds.length} queued`);
    return userIds.length;
  }
}
