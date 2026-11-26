import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { notes } from '../database/schema.js';

/** The UTC day of `date`, as YYYY-MM-DD. */
export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class DigestRepository {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  /** The users who changed a note on `day`. */
  async authorsOn(day: string): Promise<string[]> {
    const rows = await this.db.selectDistinct({ ownerId: notes.ownerId }).from(notes).where(changedOn(day));
    return rows.map((row) => row.ownerId);
  }

  /** The titles of the notes a user changed on `day`, oldest first. */
  async titlesOn(userId: string, day: string): Promise<string[]> {
    const rows = await this.db
      .select({ title: notes.title })
      .from(notes)
      .where(and(eq(notes.ownerId, userId), changedOn(day)))
      .orderBy(asc(notes.updatedAt))
      .limit(50);
    return rows.map((row) => row.title);
  }
}

function changedOn(day: string) {
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return and(gte(notes.updatedAt, start), lt(notes.updatedAt, end));
}
