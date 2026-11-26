# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only. A CommonJS project loads them through `require(esm)`, which needs Node.js 20.19+ or 22.12+, and doesn't have to convert (https://docs.nestjs.com/migration-guide.md).

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). `ObserveModule` is registered in `src/app.module.ts` already, and sends nothing until it has a key pair: `npx @nestjs/observe link` writes it (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env`. The quick start explains the SDK: https://observe.nestjs.com/documentation/sdk#quick-start

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## This project

The notes API of the JWT tutorial, plus email: a welcome email after sign-up and an evening digest of the notes each user changed that day, sent from a BullMQ queue. It is the finished app of https://docs.nestjs.com/tutorials/background-jobs, which explains each part; the sign-in, notes and health parts come unchanged from https://docs.nestjs.com/tutorials/rest-api-jwt-authentication.

- Layout: one folder per feature under `src/` (module, controller or providers, Zod schemas). `src/emails/` holds the mail classes, the queue's producer (`email.jobs.ts`), the worker (`email.processor.ts`), the outbox handler, the digest's query and scheduler, and the `sent_emails` repository. `src/redis/` holds the shared ioredis client and the lock store. `src/app.module.ts` registers everything, and creates `ObserveModule` and `ObserveInstrument`; `src/main.ts` is the HTTP entry point and `src/worker.ts` an application context without the HTTP server. Both pass `instrument: ObserveInstrument`: a new entry point must too, and `ObserveModule.forRoot()` stays first in `imports`.
- Database: the Drizzle schema is `src/database/schema.ts`; after changing it, run `npm run db:generate` and commit the migration in `drizzle/`. The outbox keeps its tables in the `nest_outbox` schema, which `PostgresOutboxStore` migrates at startup outside production; in production, run `npx @nestjs/outbox migrate` next to `npm run db:migrate`.
- Validation: Zod schemas passed to `@Body()`, `@Query()` and `@Param()` with the `schema` option. The environment is the Zod schema in `src/config.ts`, checked at startup (`MAIL_TRANSPORT=smtp` requires `SMTP_URL`). `DIGEST_CRON`, `MAIL_WORKER` and the `OBSERVE_*` keys are read from `process.env` when the module files load, before `ConfigModule` reads `.env`.
- Auth: every route requires a bearer token unless it is marked `@Public()`; mark public routes `@ApiSecurity({})` too. Writes are single conditional statements, never read-then-save.
- Jobs carry ids, never email addresses: the worker reads the user when it runs. Every email has a key (`welcome-<user id>`, `digest-<user id>-<day>`), used as the BullMQ `jobId`, the `sent_emails` primary key and the mailer's `idempotencyKey`. Keys use dashes: BullMQ refuses integer ids and most ids with `:`. Job options (`attempts`, `backoff`, `removeOnComplete`, `removeOnFail`) are passed on each `add()` in `email.jobs.ts`.
- A job never adds to the queue inside a database transaction. Work that must follow a commit goes through the outbox: `outbox.add(tx, ...)` with the transaction (never the database), then `outbox.notify()`, and an `@OnOutboxMessage()` handler adds the job (see `CredentialsService.register()` and `welcome-mail.handler.ts`).
- Every send goes through `SentEmailsRepository.sendOnce()`: its claim is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE` statement, and a failed send gives the claim back. Keep it a single statement; "sends one email, however many times its job runs at once" in `test/emails.e2e-spec.ts` fails a read-then-write version. Sends use `retry: false` (BullMQ retries the job) and a `signal` timeout well under the claim's 5-minute lease; a permanent `MailError` becomes BullMQ's `UnrecoverableError`.
- Scheduled jobs use `@Cron()` with `@OnOneInstance()`, so they run on one instance; the lock store is `RedisLockStore`, registered in `AppModule` (registering it in `RedisModule` creates an import cycle).
- Shutdown: `app.enableShutdownHooks()` lets workers finish their jobs in `onModuleDestroy`; connections close in `onApplicationShutdown`. "finishes the email in flight before it shuts down" protects that.
- Tests: `npm run test:e2e` with `TEST_DATABASE_URL` (the tests truncate its tables) and `TEST_REDIS_URL` (they flush that Redis database). Without `TEST_DATABASE_URL` both test files are skipped. Mail is replaced with `InMemoryMailTransport`; never point the tests at a real mail server.

This project is ESM: relative imports end in `.js`, and `__dirname` doesn't exist (use `import.meta.dirname`).
