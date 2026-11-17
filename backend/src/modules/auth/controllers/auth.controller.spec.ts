import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { PasswordResetService } from '../services/password-reset.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../auth.constants';

describe('AuthController', () => {
  const createController = (cookieSecure = false) => {
    const authService = {
      login: jest.fn(),
      logout: jest.fn(),
    };
    const passwordResetService = {
      requestPasswordReset: jest.fn().mockResolvedValue({
        message: '如果邮箱存在，我们将发送密码重置邮件。',
      }),
      resetPassword: jest
        .fn()
        .mockResolvedValue({ message: '密码已重置，请使用新密码登录。' }),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(cookieSecure),
    };

    return {
      authService,
      passwordResetService,
      configService,
      controller: new AuthController(
        authService as unknown as AuthService,
        passwordResetService as unknown as PasswordResetService,
        configService as unknown as ConfigService,
      ),
    };
  };

  it.each([true, false])(
    'uses configured Cookie Secure=%s on login',
    async (cookieSecure) => {
      const { controller, authService, configService } =
        createController(cookieSecure);
      const publicUser = { id: 'unit-user', email: 'teacher@example.invalid' };
      authService.login.mockResolvedValue({
        sessionToken: 'synthetic-unit-session',
        user: publicUser,
      });
      const response = { cookie: jest.fn<void, [string, string, object]>() };

      await expect(
        controller.login(
          { email: 'teacher@example.invalid', password: 'synthetic-password' },
          response,
        ),
      ).resolves.toEqual(publicUser);

      expect(configService.getOrThrow).toHaveBeenCalledWith(
        'auth.cookieSecure',
      );
      expect(response.cookie).toHaveBeenCalledTimes(1);
      expect(response.cookie.mock.calls[0]?.[0]).toBe(SESSION_COOKIE_NAME);
      expect(response.cookie.mock.calls[0]?.[2]).toEqual({
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        maxAge: SESSION_TTL_MS,
        path: '/',
      });
    },
  );

  it.each([true, false])(
    'uses configured Cookie Secure=%s on logout',
    async (cookieSecure) => {
      const { controller, authService, configService } =
        createController(cookieSecure);
      const response = { clearCookie: jest.fn<void, [string, object?]>() };

      await expect(controller.logout({}, response)).resolves.toEqual({
        ok: true,
      });

      expect(authService.logout).toHaveBeenCalledWith(undefined);
      expect(configService.getOrThrow).toHaveBeenCalledWith(
        'auth.cookieSecure',
      );
      expect(response.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        path: '/',
      });
    },
  );

  it('delegates forgot-password to password reset service', async () => {
    const { controller, passwordResetService } = createController();

    await expect(
      controller.forgotPassword({ email: 'teacher@example.com' }),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });
    expect(passwordResetService.requestPasswordReset).toHaveBeenCalledWith(
      'teacher@example.com',
    );
  });

  it('delegates reset-password to password reset service', async () => {
    const { controller, passwordResetService } = createController();

    await expect(
      controller.resetPassword({
        token: 'plain-token',
        newPassword: 'NextPass123!',
      }),
    ).resolves.toEqual({
      message: '密码已重置，请使用新密码登录。',
    });
    expect(passwordResetService.resetPassword).toHaveBeenCalledWith(
      'plain-token',
      'NextPass123!',
    );
  });

  it('trims and validates forgot-password email dto', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  Teacher@Example.com  ',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
    expect(dto.email).toBe('teacher@example.com');
  });

  it('rejects invalid forgot-password email dto', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: 'not-an-email',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('trims the reset token and leaves password normalization to the service', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: '  plain-token  ',
      newPassword: '  NextPass123!  ',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
    expect(dto.token).toBe('plain-token');
    expect(dto.newPassword).toBe('  NextPass123!  ');
  });

  it('leaves string password policy validation to the service', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'plain-token',
      newPassword: '   short  ',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });

  it('rejects a non-string new password before entering the service', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'plain-token',
      newPassword: 12345678,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.some(({ property }) => property === 'newPassword')).toBe(
      true,
    );
  });
});
