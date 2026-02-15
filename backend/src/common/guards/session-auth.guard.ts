import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/auth/services/auth.service';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { UserRole } from '../../modules/users/schemas/user-roles.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string>;
      user?: { id: string; roles: UserRole[] };
    }>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Unauthorized');
    const sessionUser = await this.authService.validateSession(token);
    if (!sessionUser) {
      throw new UnauthorizedException('Unauthorized');
    }
    request.user = {
      id: sessionUser.id,
      roles: sessionUser.roles,
    };
    return true;
  }
}
