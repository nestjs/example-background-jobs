import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';
import type { User } from '../users/user.js';

@Injectable()
export class WelcomeMail implements Mailable<User> {
  render(user: User) {
    return {
      subject: 'Welcome to Notes',
      // `html` escapes every value it inserts.
      html: html`
        <p>Hi ${user.email},</p>
        <p>your account is ready. On the days you change notes, we'll send you a digest of them in the evening.</p>
      `,
    };
  }
}
