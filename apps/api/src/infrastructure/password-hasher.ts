import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '@wistally/domain';

export class ArgonPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return hash(plain, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }
}
