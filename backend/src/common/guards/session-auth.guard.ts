import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../modules/auth/services/auth.service';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../types/authenticated-user.type';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
      method: string;
      cookies?: Record<string, unknown>;
      headers?: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException('Unauthorized');
    const sessionUser = await this.authService.validateSession(token);
    if (!sessionUser) {
      throw new UnauthorizedException('Unauthorized');
    }
    const expectedUserId = request.headers?.['x-expected-user-id'];
    // The page identity only constrains writes; the session owns authorization.
    if (
      WRITE_METHODS.has(request.method) &&
      expectedUserId !== undefined &&
      expectedUserId !== sessionUser.id
    ) {
      throw new ConflictException({
        code: 'PAGE_ACCOUNT_MISMATCH',
        message: '当前登录账号与此页面不一致，请重新打开页面后再操作。',
      });
    }
    request.user = sessionUser;
    return true;
  }
}
