import { LogMailTransport, SmtpTransport, type MailTransport } from '@nestjs/mail';

/** `log` in development: every mail goes to the console. `smtp` in production. */
export function mailTransport(kind: 'log' | 'smtp', smtpUrl?: string): MailTransport {
  return kind === 'smtp'
    ? new SmtpTransport({ url: smtpUrl!, pool: true }) // smtp://user:password@smtp.example.com:587
    : new LogMailTransport();
}
