import { AuthRequest, AuthStrategy, Principal } from '../auth-strategy.interface';

/**
 * Turns a plain function into a strategy — the quickest way to plug in custom auth:
 *
 *   AuthModule.register({
 *     strategy: createFunctionStrategy('partner-header', (req) =>
 *       req.headers['x-partner'] === 'acme' ? { partnerId: 'acme' } : null),
 *   })
 */
export function createFunctionStrategy(
  name: string,
  fn: (request: AuthRequest) => Promise<Principal | null> | Principal | null,
): AuthStrategy {
  return { name, authenticate: fn };
}
