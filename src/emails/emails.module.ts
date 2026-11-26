import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module.js';
import { DigestMail } from './digest.mail.js';
import { DigestRepository } from './digest.repository.js';
import { DigestScheduler } from './digest.scheduler.js';
import { EMAILS_QUEUE, EmailJobs } from './email.jobs.js';
import { EmailProcessor } from './email.processor.js';
import { SentEmailsRepository } from './sent-emails.repository.js';
import { WelcomeMail } from './welcome.mail.js';
import { WelcomeMailHandler } from './welcome-mail.handler.js';

@Module({
  imports: [BullModule.registerQueue({ name: EMAILS_QUEUE }), UsersModule],
  providers: [
    EmailJobs,
    // With MAIL_WORKER=off, this process adds jobs and leaves running them to others.
    ...(process.env.MAIL_WORKER === 'off' ? [] : [EmailProcessor]),
    WelcomeMail,
    DigestMail,
    DigestRepository,
    SentEmailsRepository,
    DigestScheduler,
    WelcomeMailHandler,
  ],
  exports: [EmailJobs],
})
export class EmailsModule {}
