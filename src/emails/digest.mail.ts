import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';

export interface Digest {
  /** The UTC day, as YYYY-MM-DD. */
  day: string;
  titles: string[];
}

@Injectable()
export class DigestMail implements Mailable<Digest> {
  render({ day, titles }: Digest) {
    return {
      subject: `Your notes on ${day}`,
      // Titles are user input: `html` escapes them, so a title can't inject markup.
      html: html`
        <p>You changed ${titles.length} ${titles.length === 1 ? 'note' : 'notes'} today:</p>
        <ul>
          ${titles.map((title) => html`<li>${title}</li>`)}
        </ul>
      `,
    };
  }
}
