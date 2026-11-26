import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sentEmails } from '../database/schema.js';

export class EmailInProgressError extends Error {}

@Injectable()
export class SentEmailsRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  /**
   * Runs `send` unless the email with this key was sent already. Of two workers that run the
   * same email at once, one sends it; the other throws EmailInProgressError, and its retry
   * finds it sent.
   */
  async sendOnce(key: string, userId: string, send: () => Promise<unknown>): Promise<'sent' | 'already sent'> {
    if (!(await this.claim(key, userId))) {
      const [row] = await this.db.select({ sentAt: sentEmails.sentAt }).from(sentEmails).where(eq(sentEmails.key, key));
      if (row?.sentAt) {
        return 'already sent';
      }
      throw new EmailInProgressError(`Email ${key} is being sent by another worker`);
    }
    try {
      await send();
    } catch (error) {
      // Give the claim back, so the job's retry can take it again.
      await this.db.delete(sentEmails).where(and(eq(sentEmails.key, key), isNull(sentEmails.sentAt)));
      throw error;
    }
    await this.db.update(sentEmails).set({ sentAt: sql`now()` }).where(eq(sentEmails.key, key));
    return 'sent';
  }

  /** One statement: inserts the claim, or takes over one that a crashed worker left behind. */
  private async claim(key: string, userId: string): Promise<boolean> {
    const claimed = await this.db
      .insert(sentEmails)
      .values({ key, userId })
      .onConflictDoUpdate({
        target: sentEmails.key,
        set: { claimedAt: sql`now()` },
        setWhere: sql`${sentEmails.sentAt} is null and ${sentEmails.claimedAt} < now() - interval '5 minutes'`,
      })
      .returning({ key: sentEmails.key });
    return claimed.length === 1;
  }
}
