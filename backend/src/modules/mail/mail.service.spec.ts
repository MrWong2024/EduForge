import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

type SentMail = Parameters<MailService['sendMail']>[0] & { from: string };

const mockSendMail = jest
  .fn<Promise<{ messageId: string }>, [SentMail]>()
  .mockResolvedValue({ messageId: 'message-1' });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

describe('MailService', () => {
  const smtpConfig = {
    provider: 'smtp',
    from: 'sender@example.invalid',
    smtp: {
      host: 'smtp.example.invalid',
      port: 465,
      user: 'synthetic-user',
      pass: 'synthetic-smtp-password',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([undefined, 'log'])(
    'logs only metadata with provider=%p and no sender or SMTP configuration',
    async (provider) => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const config = new ConfigService(
        provider === undefined ? {} : { mail: { provider } },
      );
      const getConfigSpy = jest.spyOn(config, 'get');
      const service = new MailService(config);
      const options = {
        to: 'recipient@example.invalid',
        subject: 'Synthetic mail subject',
        text: 'SYNTHETIC_TEXT_BODY\nSecond line',
        html: '<p>SYNTHETIC_HTML_BODY</p>',
      };

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      await service.sendMail(options);

      expect(getConfigSpy.mock.calls).toEqual([['mail.provider']]);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(loggerSpy.mock.calls).toEqual([
        [
          'mail provider=log to=recipient@example.invalid subject="Synthetic mail subject"',
        ],
      ]);
      const logs = JSON.stringify(loggerSpy.mock.calls);
      expect(logs).not.toContain('SYNTHETIC_TEXT_BODY');
      expect(logs).not.toContain(options.html);
      expect(logs).not.toContain('body=');
    },
  );

  it('keeps password reset URLs, tokens and both bodies out of log output', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new MailService(
      new ConfigService({ mail: { provider: 'log' } }),
    );
    const sendMailSpy = jest.spyOn(service, 'sendMail');
    const resetUrl =
      'https://example.test/reset-password?token=SUPER_SECRET_RESET_TOKEN';

    await service.sendPasswordResetEmail({
      to: 'recipient@example.invalid',
      resetUrl,
      expiresInMinutes: 30,
    });

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(loggerSpy.mock.calls).toEqual([
      [
        'mail provider=log to=recipient@example.invalid subject="EduForge 密码重置"',
      ],
    ]);
    const logs = loggerSpy.mock.calls.flat().join('\n');
    const [{ text, html }] = sendMailSpy.mock.calls[0];
    for (const sensitive of [
      resetUrl,
      'SUPER_SECRET_RESET_TOKEN',
      'token=',
      text,
      html,
      '您收到这封邮件',
    ]) {
      expect(logs).not.toContain(sensitive);
    }
  });

  it('sends password reset mail using SMTP with the existing sender and secure defaults', async () => {
    const service = new MailService(new ConfigService({ mail: smtpConfig }));
    const resetUrl =
      'https://example.test/reset-password?token=SYNTHETIC_SMTP_RESET_TOKEN';

    await service.sendPasswordResetEmail({
      to: 'recipient@example.invalid',
      resetUrl,
      expiresInMinutes: 30,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.invalid',
      port: 465,
      secure: true,
      auth: {
        user: 'synthetic-user',
        pass: 'synthetic-smtp-password',
      },
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const [sent] = mockSendMail.mock.calls[0];
    expect(sent).toMatchObject({
      from: '"EduForge" <sender@example.invalid>',
      to: 'recipient@example.invalid',
      subject: 'EduForge 密码重置',
    });
    expect(sent.text).toContain(resetUrl);
    expect(sent.html).toContain('<a href="' + resetUrl + '">');
  });

  it('preserves explicit SMTP transport settings and forwards all mail fields', async () => {
    const service = new MailService(
      new ConfigService({
        mail: {
          ...smtpConfig,
          fromName: 'Custom "Sender"',
          smtp: { ...smtpConfig.smtp, port: 587, secure: false },
        },
      }),
    );
    const options = {
      to: 'recipient@example.invalid',
      subject: 'Synthetic SMTP subject',
      text: 'Synthetic plain body\nSecond line',
      html: '<p>Synthetic HTML body</p>',
    };

    await service.sendMail(options);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.invalid',
      port: 587,
      secure: false,
      auth: {
        user: 'synthetic-user',
        pass: 'synthetic-smtp-password',
      },
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Custom \\"Sender\\"" <sender@example.invalid>',
      ...options,
    });
  });

  it.each([
    ['from', 'MAIL_FROM'],
    ['host', 'SMTP_HOST'],
    ['port', 'SMTP_PORT'],
    ['user', 'SMTP_USER'],
    ['pass', 'SMTP_PASS'],
  ])('fails fast when SMTP configuration %s is missing', (key, envKey) => {
    const mail =
      key === 'from'
        ? { ...smtpConfig, from: undefined }
        : { ...smtpConfig, smtp: { ...smtpConfig.smtp, [key]: undefined } };

    expect(() => new MailService(new ConfigService({ mail }))).toThrow(
      envKey + ' is required when MAIL_PROVIDER=smtp',
    );
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
