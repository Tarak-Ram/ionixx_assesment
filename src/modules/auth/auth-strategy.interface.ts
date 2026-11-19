import type { IncomingHttpHeaders } from 'http';

export const AUTH_STRATEGY = Symbol('AUTH_STRATEGY');

/** The authenticated caller. `partnerId` is the tenant key used to isolate order history. */
export interface Principal {
  partnerId: string;
  scopes?: string[];
}

/** Minimal, framework-free view of the request that strategies may inspect. */
export interface AuthRequest {
  headers: IncomingHttpHeaders;
  method: string;
  path: string;
}

/**
 * Extension point for authentication.
 *
 * Return a Principal when the credentials are valid, or `null` when they are missing/invalid
 * (the guard turns that into a 401). Throwing is reserved for unexpected failures.
 * To add a new scheme (OAuth2 introspection, mTLS, HMAC signature, ...) implement this
 * interface — or use `createFunctionStrategy` — and pass it to `AuthModule.register()`.
 */
export interface AuthStrategy {
  readonly name: string;
  authenticate(request: AuthRequest): Promise<Principal | null> | Principal | null;
}
