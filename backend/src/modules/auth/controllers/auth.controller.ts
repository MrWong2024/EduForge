import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../auth.constants';
import { Public } from '../../../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true })
    response: {
      cookie: (name: string, value: string, options: object) => void;
    },
  ) {
    const result = await this.authService.login(dto);
    const env = this.configService.get<string>('app.env') ?? 'development';
    response.cookie(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    return result.user;
  }

  @Post('logout')
  async logout(
    @Req() request: { cookies?: Record<string, string> },
    @Res({ passthrough: true })
    response: { clearCookie: (name: string, options?: object) => void },
  ) {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    await this.authService.logout(token);
    const env = this.configService.get<string>('app.env') ?? 'development';
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env === 'production',
      path: '/',
    });
    return { ok: true };
  }
}
