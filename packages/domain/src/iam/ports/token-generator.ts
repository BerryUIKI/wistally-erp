export interface GeneratedToken {
  readonly raw: string;
  readonly hash: string;
}

/**
 * Opaque bearer tokens. Only the hash is persisted; the raw value exists solely
 * in the cookie and in memory.
 */
export interface TokenGenerator {
  generate(): GeneratedToken;
  hash(raw: string): string;
}
