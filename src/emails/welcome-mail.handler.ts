import { Injectable } from '@nestjs/common';
import { OnOutboxMessage } from '@nestjs/outbox';
import { EmailJobs } from './email.jobs.js';

export interface UserSignedUp {
  userId: string;
}

@Injectable()
export class WelcomeMailHandler {
  constructor(private readonly emailJobs: EmailJobs) {}

  // Runs once the sign-up committed. If Redis is down, the outbox retries with backoff.
  @OnOutboxMessage('user.signed-up', { consumer: 'welcome-mail' })
  async queueWelcome({ userId }: UserSignedUp) {
    await this.emailJobs.welcome(userId);
  }
}
