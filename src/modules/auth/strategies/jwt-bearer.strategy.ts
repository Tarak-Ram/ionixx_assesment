import { JwtPayload, verify, VerifyOptions } from 'jsonwebtoken';
import { AuthRequest, AuthStrategy, Principal } from '../auth-strategy.interface';

export interface JwtStrategyOptions {
  secret: string;
  issuer?: string;
  audience?: string;
}

/**
 * AUTH_MODE=jwt: `Authorization: Bearer <jwt>` signed with HS256.
 * The algorithm is pinned (prevents alg=none / key-confusion attacks); `sub` is the partner id.
 * For RS256/JWKS (e.g. Auth0, Cognito) implement a sibling strategy with the same contract.
 */
export class JwtBearerStrategy implements AuthStrategy {
  readonly name = 'jwt';

  constructor(private readonly options: JwtStrategyOptions) {}

  authenticate(request: AuthRequest): Principal | null {
    const header = request.headers.authorization;
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    if (!match) return null;

    const verifyOptions: VerifyOptions = { algorithms: ['HS256'] };
    if (this.options.issuer) verifyOptions.issuer = this.options.issuer;
    if (this.options.audience) verifyOptions.audience = this.options.audience;

    try {
      const payload = verify(match[1], this.options.secret, verifyOptions) as JwtPayload | string;
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub)
        return null;
      const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : undefined;
      return { partnerId: payload.sub, scopes: scope };
    } catch {
      return null; // expired, bad signature, wrong issuer/audience, malformed ...
    }
  }
}
