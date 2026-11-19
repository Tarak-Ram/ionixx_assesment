import { AuthStrategy, Principal } from '../auth-strategy.interface';

export const ANONYMOUS_PARTNER = 'anonymous';

/** AUTH_MODE=none: every caller is the same anonymous partner. For local/demo use only. */
export class NoAuthStrategy implements AuthStrategy {
  readonly name = 'none';

  authenticate(): Principal {
    return { partnerId: ANONYMOUS_PARTNER };
  }
}
