import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Principal } from './auth-strategy.interface';

export const IS_PUBLIC = 'isPublic';
/** Opt a route out of authentication (e.g. health checks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Injects the authenticated Principal set by the AuthGuard. */
export const CurrentPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<{ principal: Principal }>().principal,
);

export const REQUIRED_SCOPES = 'requiredScopes';
/**
 * Require every listed scope on the caller. Enforced only for principals that carry a `scopes`
 * list (e.g. a JWT with a `scope` claim); strategies without scopes (api-key, none) are not restricted.
 */
export const RequireScopes = (...scopes: string[]) => SetMetadata(REQUIRED_SCOPES, scopes);
