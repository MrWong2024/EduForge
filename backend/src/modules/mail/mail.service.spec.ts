import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('MailService', () => {
  const createConfigService = (
    values: Record<string, string | number | boolean>,
  ) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs password reset emails when provider=log', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new MailService(
      createConfigService({
        'mail.provider': 'log',
        'mail.from': 'noreply@mail.cqupt.fun',
        'mail.fromName': 'EduForge',
      }),
    );

    await service.sendPasswordResetEmail({
      to: 'user@example.com',
      resetUrl: 'http://localhost:3000/reset-password?token=plain-token',
      expiresInMinutes: 30,
    });

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('reset-password?token=plain-token'),
    );
    loggerSpy.mockRestore();
  });

  it('sends smtp mail with formatted from address when provider=smtp', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-1' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new MailService(
      createConfigService({
        'mail.provider': 'smtp',
        'mail.from': 'noreply@mail.cqupt.fun',
        'mail.fromName': 'EduForge',
        'mail.smtp.host': 'smtpdm.aliyun.com',
        'mail.smtp.port': 465,
        'mail.smtp.secure': true,
        'mail.smtp.user': 'noreply@mail.cqupt.fun',
        'mail.smtp.pass': 'smtp-password',
      }),
    );

    await service.sendPasswordResetEmail({
      to: 'user@example.com',
      resetUrl: 'https://frontend.example.com/reset-password?token=plain-token',
      expiresInMinutes: 30,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtpdm.aliyun.com',
      port: 465,
      secure: true,
      auth: {
        user: 'noreply@mail.cqupt.fun',
        pass: 'smtp-password',
      },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"EduForge" <noreply@mail.cqupt.fun>',
        to: 'user@example.com',
        subject: 'EduForge 密码重置',
      }),
    );
  });

  it('fails fast when smtp provider misses required config', () => {
    expect(
      () =>
        new MailService(
          createConfigService({
            'mail.provider': 'smtp',
            'mail.from': '',
            'mail.fromName': 'EduForge',
            'mail.smtp.host': '',
            'mail.smtp.port': 465,
            'mail.smtp.secure': true,
            'mail.smtp.user': '',
            'mail.smtp.pass': '',
          }),
        ),
    ).toThrow('SMTP_HOST is required when MAIL_PROVIDER=smtp');
  });
});
