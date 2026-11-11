import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { IS_PUBLIC_KEY, Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

@Roles('student')
class RoleRoutes {
  inherited(this: void) {
    return 'inherited';
  }

  @Roles('user')
  overridden(this: void) {
    return 'overridden';
  }

  @Roles('student', 'user')
  multiple(this: void) {
    return 'multiple';
  }

  @Roles('unknown-role')
  unknown(this: void) {
    return 'unknown';
  }

  @Roles()
  empty(this: void) {
    return 'empty';
  }

  @Public()
  @Roles()
  publicMethod(this: void) {
    return 'public';
  }
}

class NoRoleRoutes {
  missing(this: void) {
    return 'missing';
  }
}

@Public()
class PublicRoutes {
  inherited(this: void) {
    return 'public';
  }

  @SetMetadata(IS_PUBLIC_KEY, false)
  @Roles('student')
  protectedMethod(this: void) {
    return 'protected';
  }
}

type GuardRequest = { user?: { id: string; roles?: string[] } };

function context(
  controller: new () => object,
  handler: () => string,
  request: GuardRequest = {},
) {
  return new ExecutionContextHost([request], controller, handler);
}

describe('RolesGuard (no I/O)', () => {
  const guard = new RolesGuard(new Reflector());
  const student = { user: { id: 'synthetic-student', roles: ['student'] } };

  it('constructs with only a Reflector and inherits class roles', () => {
    expect(
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.inherited, student),
      ),
    ).toBe(true);
  });

  it('uses method roles instead of merging them with class roles', () => {
    expect(() =>
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.overridden, student),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
    expect(
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.overridden, {
          user: { id: 'synthetic-user', roles: ['user'] },
        }),
      ),
    ).toBe(true);
  });

  it('accepts at least one matching valid role among nonmatching and unknown roles', () => {
    expect(
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.multiple, {
          user: {
            id: 'synthetic-user',
            roles: ['unknown-role', 'teacher', 'user'],
          },
        }),
      ),
    ).toBe(true);
  });

  it('filters unknown roles even when they match required metadata', () => {
    expect(() =>
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.unknown, {
          user: { id: 'synthetic-unknown', roles: ['unknown-role'] },
        }),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
  });

  it.each<GuardRequest>([
    {},
    { user: { id: 'synthetic-no-roles' } },
    { user: { id: 'synthetic-empty-roles', roles: [] } },
    { user: { id: 'synthetic-unknown', roles: ['unknown-role'] } },
    { user: { id: 'synthetic-admin', roles: ['admin'] } },
  ])('rejects a missing or nonmatching identity (%p)', (request) => {
    expect(() =>
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.inherited, request),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
  });

  it('rejects absent required-role metadata', () => {
    expect(() =>
      guard.canActivate(
        context(NoRoleRoutes, NoRoleRoutes.prototype.missing, student),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
  });

  it('rejects empty method roles even when class roles match', () => {
    expect(() =>
      guard.canActivate(
        context(RoleRoutes, RoleRoutes.prototype.empty, student),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
  });

  it('allows Public methods before identity and role checks', () => {
    expect(
      guard.canActivate(context(RoleRoutes, RoleRoutes.prototype.publicMethod)),
    ).toBe(true);
  });

  it('inherits class-level Public metadata without roles or identity', () => {
    expect(
      guard.canActivate(
        context(PublicRoutes, PublicRoutes.prototype.inherited),
      ),
    ).toBe(true);
  });

  it('lets method-level false override class-level Public metadata', () => {
    expect(() =>
      guard.canActivate(
        context(PublicRoutes, PublicRoutes.prototype.protectedMethod),
      ),
    ).toThrow(new ForbiddenException('Forbidden resource'));
    expect(
      guard.canActivate(
        context(PublicRoutes, PublicRoutes.prototype.protectedMethod, student),
      ),
    ).toBe(true);
  });
});
