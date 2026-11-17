import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/auth/services/auth.service';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../types/authenticated-user.type';

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
      cookies?: Record<string, unknown>;
      user?: AuthenticatedUser;
    }>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Unauthorized');
    const sessionUser = await this.authService.validateSession(token);
    if (!sessionUser) {
      throw new UnauthorizedException('Unauthorized');
    }
    request.user = sessionUser;
    return true;
  }
}
