import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type MailProvider = 'log' | 'smtp';

type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type PasswordResetEmailOptions = {
  expiresInMinutes: number;
  resetUrl: string;
  to: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailProvider;
  private readonly fromAddress?: string;
  private readonly smtpTransport?: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.provider =
      (this.configService.get<string>('mail.provider') as MailProvider) ??
      'log';
    if (this.provider === 'smtp') {
      const from = this.requireConfig('mail.from', 'MAIL_FROM');
      const fromName =
        this.configService.get<string>('mail.fromName') ?? 'EduForge';
      this.fromAddress = `"${fromName.replace(/"/g, '\\"')}" <${from}>`;
      this.smtpTransport = nodemailer.createTransport({
        host: this.requireConfig('mail.smtp.host', 'SMTP_HOST'),
        port: this.requireNumberConfig('mail.smtp.port', 'SMTP_PORT'),
        secure: this.configService.get<boolean>('mail.smtp.secure') ?? true,
        auth: {
          user: this.requireConfig('mail.smtp.user', 'SMTP_USER'),
          pass: this.requireConfig('mail.smtp.pass', 'SMTP_PASS'),
        },
      });
    }
  }

  async sendPasswordResetEmail(
    options: PasswordResetEmailOptions,
  ): Promise<void> {
    const subject = 'EduForge 密码重置';
    const text = [
      '您收到这封邮件，是因为有人请求重置 EduForge 账号密码。',
      `请在 ${options.expiresInMinutes} 分钟内打开以下链接设置新密码：`,
      options.resetUrl,
      '如果这不是您本人操作，可以忽略此邮件。',
    ].join('\n\n');
    const html = [
      '<p>您收到这封邮件，是因为有人请求重置 EduForge 账号密码。</p>',
      `<p>请在 ${options.expiresInMinutes} 分钟内打开以下链接设置新密码：</p>`,
      `<p><a href="${options.resetUrl}">${options.resetUrl}</a></p>`,
      '<p>如果这不是您本人操作，可以忽略此邮件。</p>',
    ].join('');

    await this.sendMail({
      to: options.to,
      subject,
      text,
      html,
    });
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    if (this.provider === 'log') {
      this.logger.log(
        `mail provider=log to=${options.to} subject="${options.subject}"`,
      );
      return;
    }

    if (!this.smtpTransport) {
      throw new Error('SMTP transport is not configured');
    }

    await this.smtpTransport.sendMail({
      from: this.fromAddress,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }

  private requireConfig(configKey: string, envKey: string): string {
    const value = this.configService.get<string>(configKey);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    throw new Error(`${envKey} is required when MAIL_PROVIDER=smtp`);
  }

  private requireNumberConfig(configKey: string, envKey: string): number {
    const value = this.configService.get<number>(configKey);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    throw new Error(`${envKey} is required when MAIL_PROVIDER=smtp`);
  }
}
