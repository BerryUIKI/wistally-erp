import type { Result, Tx } from '@wistally/kernel';

import type { AccountMappingKey } from '../account-mappings.js';
import type { PostingContext } from '../posting.js';

/**
 * Resolves a posting key to one of the company's leaf accounts.
 *
 * The priority is: item-category override, party override, company default,
 * then fail. The MVP stores the company default; the context is part of the
 * contract so the overrides can be added without changing callers.
 */
export interface AccountResolver {
  resolve(
    tx: Tx,
    companyId: string,
    key: AccountMappingKey,
    context: PostingContext,
  ): Promise<Result<string>>;
}
