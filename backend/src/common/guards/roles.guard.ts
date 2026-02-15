import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AUTHENTICATED_ROLES,
  UserRole,
  hasAnyRole,
} from '../../modules/users/schemas/user-roles.constants';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (isPublic) {
      return true;
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const isEnforced =
      this.configService.get<string>('AUTHZ_ENFORCE_ROLES') !== 'false';
    if (!isEnforced) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id: string; roles?: string[] };
    }>();
    const userRoles = request.user?.roles ?? [];
    const normalizedUserRoles = userRoles.filter((role): role is UserRole =>
      AUTHENTICATED_ROLES.includes(role as UserRole),
    );

    if (requiredRoles.length === 0) {
      throw new ForbiddenException('Forbidden resource');
    }

    if (hasAnyRole(normalizedUserRoles, requiredRoles)) {
      return true;
    }

    throw new ForbiddenException('Forbidden resource');
  }
}
