import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sign } from 'jsonwebtoken';
import { AuthRequest } from '../../src/modules/auth/auth-strategy.interface';
import { AuthGuard } from '../../src/modules/auth/auth.guard';
import { buildStrategy } from '../../src/modules/auth/auth.module';
import { ApiKeyStrategy } from '../../src/modules/auth/strategies/api-key.strategy';
import { createFunctionStrategy } from '../../src/modules/auth/strategies/function.strategy';
import { JwtBearerStrategy } from '../../src/modules/auth/strategies/jwt-bearer.strategy';
import { NoAuthStrategy } from '../../src/modules/auth/strategies/no-auth.strategy';

const req = (headers: Record<string, string>): AuthRequest => ({
  headers,
  method: 'GET',
  path: '/',
});
const SECRET = 'a-very-long-secret-with-at-least-32-chars!!';

describe('ApiKeyStrategy', () => {
  const strategy = new ApiKeyStrategy({ 'key-a': 'partner-a', 'key-b': 'partner-b' });

  it('maps a valid key to its partner', () => {
    expect(strategy.authenticate(req({ 'x-api-key': 'key-b' }))).toEqual({
      partnerId: 'partner-b',
    });
  });
  it.each([[{}], [{ 'x-api-key': 'nope' }], [{ 'x-api-key': '' }]])('rejects %j', (headers) => {
    expect(strategy.authenticate(req(headers))).toBeNull();
  });
});

describe('JwtBearerStrategy', () => {
  const strategy = new JwtBearerStrategy({ secret: SECRET, issuer: 'ionixx', audience: 'orders' });
  const token = (claims: object, secret = SECRET, opts = {}) =>
    sign(claims, secret, { algorithm: 'HS256', issuer: 'ionixx', audience: 'orders', ...opts });
  const bearer = (t: string) => req({ authorization: `Bearer ${t}` });

  it('accepts a valid token and reads the partner from `sub`', () => {
    expect(
      strategy.authenticate(bearer(token({ sub: 'partner-a', scope: 'orders:read orders:write' }))),
    ).toEqual({
      partnerId: 'partner-a',
      scopes: ['orders:read', 'orders:write'],
    });
  });

  it('rejects wrong signature, expiry, issuer, audience, missing sub and malformed headers', () => {
    expect(strategy.authenticate(bearer(token({ sub: 'p' }, 'x'.repeat(40))))).toBeNull();
    expect(
      strategy.authenticate(bearer(token({ sub: 'p' }, SECRET, { expiresIn: -10 }))),
    ).toBeNull();
    expect(
      strategy.authenticate(bearer(token({ sub: 'p' }, SECRET, { issuer: 'evil' }))),
    ).toBeNull();
    expect(
      strategy.authenticate(bearer(token({ sub: 'p' }, SECRET, { audience: 'other' }))),
    ).toBeNull();
    expect(strategy.authenticate(bearer(token({})))).toBeNull();
    expect(strategy.authenticate(req({}))).toBeNull();
    expect(strategy.authenticate(req({ authorization: 'Basic abc' }))).toBeNull();
  });

  it('rejects unsigned (alg=none) tokens', () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      '{"sub":"p","iss":"ionixx","aud":"orders"}',
    ).toString('base64url')}.`;
    expect(strategy.authenticate(bearer(none))).toBeNull();
  });
});

describe('createFunctionStrategy (custom auth hook)', () => {
  it('wraps any function as a strategy', async () => {
    const strategy = createFunctionStrategy('custom', (r) =>
      r.headers['x-partner'] === 'acme' ? { partnerId: 'acme' } : null,
    );
    expect(strategy.name).toBe('custom');
    expect(await strategy.authenticate(req({ 'x-partner': 'acme' }))).toEqual({
      partnerId: 'acme',
    });
    expect(await strategy.authenticate(req({}))).toBeNull();
  });
});

describe('buildStrategy', () => {
  it('selects the strategy from AUTH_MODE', () => {
    const base = { apiKeys: { k: 'p' }, jwtSecret: SECRET };
    expect(buildStrategy({ ...base, mode: 'none' })).toBeInstanceOf(NoAuthStrategy);
    expect(buildStrategy({ ...base, mode: 'api-key' })).toBeInstanceOf(ApiKeyStrategy);
    expect(buildStrategy({ ...base, mode: 'jwt' })).toBeInstanceOf(JwtBearerStrategy);
  });
});

describe('AuthGuard', () => {
  const contextFor = (request: object): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const reflector = (isPublic: boolean) =>
    ({ getAllAndOverride: () => isPublic }) as unknown as Reflector;

  it('attaches the principal when authentication succeeds', async () => {
    const guard = new AuthGuard(
      createFunctionStrategy('t', () => ({ partnerId: 'p1' })),
      reflector(false),
    );
    const request: Record<string, unknown> = { headers: {}, method: 'GET', path: '/' };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.principal).toEqual({ partnerId: 'p1' });
  });

  it('throws 401 when the strategy returns null', async () => {
    const guard = new AuthGuard(
      createFunctionStrategy('t', () => null),
      reflector(false),
    );
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('skips authentication for @Public routes', async () => {
    const strategy = createFunctionStrategy('t', jest.fn());
    const guard = new AuthGuard(strategy, reflector(true));
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
  });
});
