# Send emails and run background jobs with NestJS

This is the finished application of the tutorial [Send emails and run background jobs in Node.js](https://docs.nestjs.com/tutorials/background-jobs) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

It is the notes API of the [JWT tutorial](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication) (sign-up, JWT access and refresh tokens, owner-scoped notes on PostgreSQL through Drizzle), plus email:

- A welcome email after sign-up, and an evening digest (18:00 UTC) of the notes each user changed that day, written as `@nestjs/mail` mail classes with escaped HTML.
- Every email is sent from a BullMQ queue on Redis, with 10 attempts, exponential backoff, and finished jobs removed after a day (completed) or a week (failed).
- Sign-up writes the user and an outbox message in one transaction (`@nestjs/outbox`), so the welcome email isn't lost in a crash, and sign-up still answers 201 while Redis is down.
- Each email is sent once, even when its job runs several times at once: a single-statement claim in the `sent_emails` table.
- The digest is queued by a cron job that runs on one instance of the application (`@nestjs/schedule` with `@nestjs/locks`, on Redis).
- On shutdown, the email being sent finishes first. The workers can run in a process of their own (`npm run start:worker`).

In development, mail is written to the console (`LogMailTransport`); set `MAIL_TRANSPORT=smtp` and `SMTP_URL` to send it.

## Run it

You need Node.js 22 or later, and Docker for PostgreSQL and Redis.

```bash
git clone https://github.com/nestjs/example-background-jobs.git
cd example-background-jobs
npm install
cp .env.example .env              # then set JWT_SECRET: openssl rand -base64 32
docker compose up -d
npm run db:migrate
npm run start:dev
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs. Sign up, and the welcome email appears in the console a moment later:

```bash
curl localhost:3000/auth/sign-up --json '{"email":"ada@example.com","password":"correct horse battery"}'
```

To see a digest without waiting for the evening, set its schedule in the environment (it's read before `.env`), as in the tutorial's [Try it](https://docs.nestjs.com/tutorials/background-jobs#try-it):

```bash
npm run build
DIGEST_CRON='*/10 * * * * *' npm run start:prod
```

To run the workers apart from the API, start the API with `MAIL_WORKER=off` and the workers with `npm run start:worker` ([Run the workers in a process of their own](https://docs.nestjs.com/tutorials/background-jobs#run-the-workers-in-a-process-of-their-own)).

## Emails

| Email | Sent when | Section |
| --- | --- | --- |
| Welcome | `POST /auth/sign-up` commits | [Hand the welcome email to the queue](https://docs.nestjs.com/tutorials/background-jobs#hand-the-welcome-email-to-the-queue) |
| Digest | Every evening at 18:00 UTC, to each user who changed notes that day | [Send the digest from one instance](https://docs.nestjs.com/tutorials/background-jobs#send-the-digest-from-one-instance) |

## Endpoints

The tutorial adds no endpoints. The API's are the [JWT tutorial's](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication):

- `POST /auth/sign-up`
- `POST /auth/token`
- `POST /auth/token/refresh`
- `POST /auth/token/revoke`
- `GET /me`
- `GET|POST /notes`
- `GET|PATCH|DELETE /notes/:id`
- `GET /health/live`
- `GET /health/ready`
- `GET /docs` (Swagger UI)

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | the HTTP entry point: Node adapter, JSON logs in production, Swagger UI, shutdown hooks |
| `src/worker.ts` | the same application without the HTTP server, for worker processes |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, throttler, mail, BullMQ, outbox, schedule, locks |
| `src/config.ts` | the environment, as a Zod schema checked at startup |
| `src/database/schema.ts` | Drizzle tables: users, notes, refresh_tokens, sent_emails |
| `src/emails/` | the mail classes, the queue's producer and worker, the outbox handler, the digest's query and scheduler, `sendOnce()` |
| `src/redis/` | the shared ioredis client and the lock store |
| `src/auth/`, `src/users/`, `src/notes/`, `src/health/` | sign-in, notes and health checks, from the JWT tutorial |
| `test/` | e2e tests on PostgreSQL and Redis: the emails, and the refresh-token store contract |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:notes@localhost:5432/notes_test \
TEST_REDIS_URL=redis://localhost:6379/1 \
npm run test:e2e
```

`docker compose` creates the `notes_test` database. The tests truncate its tables and flush the Redis database they're given, so never point them at your development data. They cover the welcome email, three copies of one job racing (one email), a retried 451 and a refused 550, the digest on two instances at once, and shutdown with a send in flight ([Test it](https://docs.nestjs.com/tutorials/background-jobs#test-it)).

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [`@nestjs/mail`](https://docs.nestjs.com/application/mail), [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues) with [BullMQ](https://docs.bullmq.io) and Redis, [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox), [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling), [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks), [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [Zod](https://zod.dev) validation, [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), and Vitest.

## Production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/background-jobs#production-checklist. In short: a real mail transport, Redis with persistence and `maxmemory-policy noeviction`, `npx @nestjs/outbox migrate` on deploy, and a grace period longer than the longest job.

To see requests, errors, and the email jobs and digest runs with their attempts and failures in production, use [NestJS Observe](https://docs.nestjs.com/observability/overview). `ObserveModule` is already registered in `src/app.module.ts`; `npx @nestjs/observe link` writes the key pair into `.env`. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment of the API and the worker processes.

## License

MIT
