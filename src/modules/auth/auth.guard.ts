import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AUTH_STRATEGY, AuthStrategy, Principal } from './auth-strategy.interface';
import { IS_PUBLIC, REQUIRED_SCOPES } from './auth.decorators';

/** Global guard: delegates to the configured AuthStrategy and attaches the Principal. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_STRATEGY) private readonly strategy: AuthStrategy,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const principal = await this.strategy.authenticate({
      headers: request.headers,
      method: request.method,
      path: request.path,
    });
    if (!principal) throw new UnauthorizedException('Missing or invalid credentials');

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && principal.scopes) {
      const granted = new Set(principal.scopes);
      const missing = required.filter((scope) => !granted.has(scope));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_SCOPE',
          message: 'The credentials lack a required scope',
          details: { required: missing },
        });
      }
    }

    request.principal = principal;
    return true;
  }
}
