import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { PasswordResetService } from '../services/password-reset.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';

describe('AuthController', () => {
  const createController = () => {
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
      get: jest.fn().mockReturnValue('development'),
    };

    return {
      authService,
      passwordResetService,
      controller: new AuthController(
        authService as unknown as AuthService,
        passwordResetService as unknown as PasswordResetService,
        configService as unknown as ConfigService,
      ),
    };
  };

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

  it('trims reset-password dto and accepts valid password length', async () => {
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
    expect(dto.newPassword).toBe('NextPass123!');
  });

  it('rejects reset-password dto when trimmed password is too short', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'plain-token',
      newPassword: '   short  ',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});
