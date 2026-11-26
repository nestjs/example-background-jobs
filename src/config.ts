import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.url(),
    // Signs the access tokens: at least 32 bytes.
    JWT_SECRET: z.string().min(32),
    // The browser origins allowed to call the API, comma-separated. None by default.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
      .pipe(z.array(z.url())),
    // The queue's jobs and the locks. A database number in the path: redis://host:6379/1
    REDIS_URL: z.url(),
    // `log` writes each mail to the console instead of sending it.
    MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    SMTP_URL: z.url().optional(),
    MAIL_FROM: z.string().default('Notes <notes@example.com>'),
  })
  .refine((env) => env.MAIL_TRANSPORT !== 'smtp' || env.SMTP_URL, {
    message: 'SMTP_URL is required when MAIL_TRANSPORT is "smtp"',
    path: ['SMTP_URL'],
  });

export type Env = z.infer<typeof envSchema>;
