import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test, TestingModule } from '@nestjs/testing';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { AuthService } from '../../modules/auth/services/auth.service';
import { Public } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { SessionAuthGuard } from './session-auth.guard';

class RouteTargets {
  protectedRoute(this: void) {}

  @Public()
  publicRoute(this: void) {}
}

describe('SessionAuthGuard page identity', () => {
  const pageId = '507f1f77bcf86cd799439011';
  const sessionUser: AuthenticatedUser = {
    id: pageId,
    roles: ['student'],
    sessionId: 'synthetic-session-key',
    credentialVersion: 2,
  };
  const validateSession = jest.fn<
    Promise<AuthenticatedUser | null>,
    [unknown]
  >();
  let module: TestingModule | undefined;
  let guard: SessionAuthGuard;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        SessionAuthGuard,
        Reflector,
        { provide: AuthService, useValue: { validateSession } },
      ],
    }).compile();
    guard = module.get(SessionAuthGuard);
  });

  beforeEach(() => {
    validateSession.mockReset().mockResolvedValue(sessionUser);
  });
  afterAll(async () => module?.close());

  function target(
    method: string,
    expectedId: string | string[] | undefined,
    authenticated = true,
    isPublic = false,
  ) {
    const request: {
      method: string;
      cookies: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    } = {
      method,
      cookies: authenticated ? { [SESSION_COOKIE_NAME]: 'synthetic' } : {},
      headers: { 'x-expected-user-id': expectedId },
    };
    const handler = isPublic
      ? RouteTargets.prototype.publicRoute
      : RouteTargets.prototype.protectedRoute;
    return {
      request,
      context: new ExecutionContextHost([request], RouteTargets, handler),
    };
  }

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'exposes only session-derived identity on matching %s requests',
    async (method) => {
      const { request, context } = target(method, pageId);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(sessionUser);
      expect(validateSession).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { name: 'different account', expectedId: '507f1f77bcf86cd799439012' },
    { name: 'explicit missing page identity', expectedId: '' },
    { name: 'repeated header values', expectedId: [pageId, pageId] },
    { name: 'malformed value', expectedId: 'invalid' },
  ])(
    'rejects $name before attaching the session user',
    async ({ expectedId }) => {
      const { request, context } = target('POST', expectedId);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 409,
        response: { code: 'PAGE_ACCOUNT_MISMATCH' },
      });
      expect(request.user).toBeUndefined();
    },
  );

  it('authenticates a protected direct write with no expected identity header', async () => {
    const { request, context } = target('PATCH', undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(sessionUser);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'authenticates a %s request independently of the write precondition',
    async (method) => {
      const { request, context } = target(method, 'different-account');
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(sessionUser);
    },
  );

  it.each([true, false])(
    'returns 401 before checking an empty expectation (cookie present: %s)',
    async (authenticated) => {
      validateSession.mockResolvedValueOnce(null);
      const { context } = target('POST', '', authenticated);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: 401,
      });
      expect(validateSession).toHaveBeenCalledTimes(authenticated ? 1 : 0);
    },
  );

  it('preserves public auth entry behavior', async () => {
    const { request, context } = target('POST', '', false, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(validateSession).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });
});
