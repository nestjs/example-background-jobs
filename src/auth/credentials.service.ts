import { ConflictException, Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { UserSignedUp } from '../emails/welcome-mail.handler.js';
import type { User } from '../users/user.js';
import { UsersRepository } from '../users/users.repository.js';

@Injectable()
export class CredentialsService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly outbox: Outbox<NodePgTransaction<{}>>,
  ) {}

  async register(email: string, password: string): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(password);
    const user = await this.db.transaction(async (tx) => {
      const user = await this.usersRepository.create(email, passwordHash, tx);
      if (!user) {
        throw new ConflictException('Email already registered');
      }
      // Same transaction: the message commits with the user, or neither does.
      await this.outbox.add<UserSignedUp>(tx, { topic: 'user.signed-up', payload: { userId: user.id } });
      return user;
    });
    this.outbox.notify(); // hand it to the queue now, not at the next poll
    return user;
  }

  /** The user, or `null` when the email or the password is wrong. */
  async verify(email: string, password: string): Promise<User | null> {
    const found = await this.usersRepository.findCredentials(email);
    // With no account, verify() checks a dummy hash, so the response
    // time doesn't reveal which emails are registered.
    const valid = await this.passwordHasher.verify(password, found?.passwordHash);
    if (!valid || !found) {
      return null;
    }
    if (this.passwordHasher.needsRehash(found.passwordHash)) {
      await this.usersRepository.updatePasswordHash(found.user.id, await this.passwordHasher.hash(password));
    }
    return found.user;
  }
}
