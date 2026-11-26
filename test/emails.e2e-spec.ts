import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PasswordHasher } from '@nestjs/authentication';
import { getQueueToken } from '@nestjs/bullmq';
import { getDrizzleToken } from '@nestjs/drizzle';
import { InMemoryMailTransport, MailSmtpError, MailTransport, type MailMessage } from '@nestjs/mail';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { sentEmails, users } from '../src/database/schema.js';
import { DigestMail } from '../src/emails/digest.mail.js';
import { DigestScheduler } from '../src/emails/digest.scheduler.js';
import { EMAILS_QUEUE, EmailJobs, welcomeKey } from '../src/emails/email.jobs.js';
import { WelcomeMail } from '../src/emails/welcome.mail.js';

/** Keeps the mails, and can hold the next send open, as a slow mail server would. */
class Mailbox extends InMemoryMailTransport {
  private gate?: { started: () => void; released: Promise<void> };

  holdNext() {
    let started!: () => void;
    let release!: () => void;
    const sending = new Promise<void>((resolve) => (started = resolve));
    this.gate = { started, released: new Promise((resolve) => (release = resolve)) };
    return { sending, release };
  }

  override async send(message: MailMessage) {
    const gate = this.gate;
    this.gate = undefined;
    gate?.started();
    await gate?.released;
    return super.send(message);
  }
}

// A real PostgreSQL with a pool, so two runs of one job really race.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Emails (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  const mailbox = new Mailbox();
  let app: NestNodeApplication;
  let queue: Queue;

  /** An instance of the application, on a pool of its own. Several share the queue and the locks. */
  async function start() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(drizzle({ client: new Pool({ connectionString: url }) }))
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .compile();
    const instance = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await instance.init();
    return instance;
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, refresh_tokens CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS nest_outbox CASCADE`); // the store creates it again
    // Jobs and locks left over from an earlier run would be processed at startup.
    const redis = new Redis(process.env.REDIS_URL!);
    await redis.flushdb();
    await redis.quit();
    app = await start();
    queue = app.get<Queue>(getQueueToken(EMAILS_QUEUE));
  });

  afterAll(() => db.$client.end());
  beforeEach(() => mailbox.clear());

  let clients = 0;

  async function signUp(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email, password: 'correct horse battery' },
      remoteAddress: `10.0.0.${++clients}`, // sign-up is rate-limited per IP address
    });
    expect(res.statusCode).toBe(201);
    return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
  }

  /** A user inserted directly, so no welcome job is queued for them. */
  async function createUser(email: string) {
    const [user] = await db.insert(users).values({ email, passwordHash: 'unused' }).returning();
    return user.id;
  }

  /** Waits for a job to finish, and returns it. */
  function finished(id: string) {
    return vi.waitUntil(
      async () => {
        const job = await queue.getJob(id);
        return job?.finishedOn ? job : undefined;
      },
      { timeout: 10_000 },
    );
  }

  it('sends a welcome email after sign-up, outside the request', async () => {
    await signUp('ada@example.com');

    const mail = await vi.waitUntil(() => mailbox.find({ to: 'ada@example.com', mail: WelcomeMail }));
    expect(mail.subject).toBe('Welcome to Notes');
  });

  it('sends one email, however many times its job runs at once', async () => {
    const userId = await createUser('bob@example.com');
    const { sending, release } = mailbox.holdNext(); // the first send takes a moment
    const options = { attempts: 3, backoff: { type: 'fixed', delay: 500 } };

    // Three copies of the job: a redelivery, or a job added again after the first was removed.
    const jobs = await Promise.all([1, 2, 3].map(() => queue.add('welcome', { userId }, options)));
    await sending;
    await sleep(200); // the other two copies run meanwhile
    release();
    const results = await Promise.all(jobs.map((job) => finished(job.id!)));

    expect(results.map((job) => job.returnvalue).sort()).toEqual(['already sent', 'already sent', 'sent']);
    expect(results.map((job) => job.attemptsMade).sort()).toEqual([1, 2, 2]); // the copies waited for the first
    expect(mailbox.filter({ to: 'bob@example.com' })).toHaveLength(1);
  });

  it('retries a send that failed', async () => {
    mailbox.failNext(new MailSmtpError('DATA', { code: 451, text: 'Try again later' }));
    const userId = await createUser('carol@example.com');

    await app.get(EmailJobs).welcome(userId);
    const job = await finished(welcomeKey(userId));

    expect(job.attemptsMade).toBe(2); // the second attempt, 2 seconds later, sent it
    mailbox.assertSent({ to: 'carol@example.com', mail: WelcomeMail });
  });

  it('fails a send that the mail server refuses, without retrying', async () => {
    mailbox.failNext(new MailSmtpError('RCPT TO', { code: 550, text: 'User unknown' }));
    const userId = await createUser('nobody@example.com');

    await app.get(EmailJobs).welcome(userId);
    const job = await finished(welcomeKey(userId));

    expect(await job.getState()).toBe('failed');
    expect(job.attemptsMade).toBe(1);
    const claims = await db.select().from(sentEmails).where(eq(sentEmails.userId, userId));
    expect(claims).toEqual([]); // released: sending it again later is possible
  });

  it('queues the digests on one instance, and escapes what users wrote', async () => {
    const dave = await signUp('dave@example.com');
    await app.inject({ method: 'POST', url: '/notes', headers: dave, payload: { title: 'Fix <script> tag' } });
    const other = await start();

    // Both instances' schedulers fire at the same moment.
    const runs = await Promise.all([app, other].map((instance) => instance.get(DigestScheduler).enqueueDigests()));
    await other.close();

    expect(runs.filter((run) => run !== undefined)).toEqual([1]); // the other instance skipped it
    const mail = await vi.waitUntil(() => mailbox.find({ to: 'dave@example.com', mail: DigestMail }));
    expect(mail.html).toContain('<li>Fix &lt;script&gt; tag</li>');
  });

  it('finishes the email in flight before it shuts down', async () => {
    const { sending, release } = mailbox.holdNext();
    const userId = await createUser('erin@example.com');
    await app.get(EmailJobs).welcome(userId);
    await sending;

    let closed = false;
    const closing = app.close().then(() => (closed = true));
    await sleep(500);
    expect(closed).toBe(false); // waiting for the worker's job
    release();
    await closing;

    mailbox.assertSent({ to: 'erin@example.com' });
    const [claim] = await db.select().from(sentEmails).where(eq(sentEmails.userId, userId));
    expect(claim.sentAt).not.toBeNull();
  });
});
