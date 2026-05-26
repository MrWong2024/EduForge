import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/schemas/user.schema';
import {
  canUserAuthenticate,
  hashPassword,
  validateNewPassword,
} from '../../users/password.utils';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import { PasswordResetToken } from '../schemas/password-reset-token.schema';
import { SessionService } from './session.service';

type UserWithMeta = User & WithId & WithTimestamps;
type PasswordResetTokenWithMeta = PasswordResetToken & WithId & WithTimestamps;

@Injectable()
export class PasswordResetService implements OnModuleInit {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly resetTokenTtlMinutes = 30;
  private readonly genericForgotPasswordResponse = {
    message: '如果邮箱存在，我们将发送密码重置邮件。',
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly sessionService: SessionService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(PasswordResetToken.name)
    private readonly passwordResetTokenModel: Model<PasswordResetToken>,
  ) {}

  async onModuleInit() {
    // Ensure reset-token indexes exist even when autoIndex is disabled.
    await this.passwordResetTokenModel.ensureIndexes();
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .lean<UserWithMeta>()
      .exec();
    if (!user || !canUserAuthenticate(user.status)) {
      return this.genericForgotPasswordResponse;
    }

    const now = new Date();
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date(
      now.getTime() + this.resetTokenTtlMinutes * 60 * 1000,
    );
    const resetToken = (await this.passwordResetTokenModel.create({
      userId: user._id,
      email: user.email,
      tokenHash,
      expiresAt,
    })) as PasswordResetToken & {
      _id: Types.ObjectId;
      createdAt?: Date;
    };
    const resetTokenCreatedAt = resetToken.createdAt ?? now;

    await this.passwordResetTokenModel
      .updateMany(
        {
          userId: user._id,
          createdAt: { $lt: resetTokenCreatedAt },
          usedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
      )
      .exec();

    try {
      await this.mailService.sendPasswordResetEmail({
        to: user.email,
        resetUrl: this.buildResetUrl(plainToken),
        expiresInMinutes: this.resetTokenTtlMinutes,
      });
    } catch (error) {
      await this.passwordResetTokenModel
        .updateOne({ _id: resetToken._id }, { $set: { usedAt: now } })
        .exec();
      this.logger.error(
        `Failed to send password reset email to ${user.email}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return this.genericForgotPasswordResponse;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const now = new Date();
    const normalizedToken = token.trim();
    const password = validateNewPassword(newPassword);
    const tokenHash = this.hashToken(normalizedToken);
    const resetToken = await this.passwordResetTokenModel
      .findOne({ tokenHash })
      .lean<PasswordResetTokenWithMeta>()
      .exec();
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
      throw new BadRequestException('Reset token is invalid');
    }

    const user = await this.userModel
      .findById(resetToken.userId)
      .lean<UserWithMeta>()
      .exec();
    if (!user || !canUserAuthenticate(user.status)) {
      throw new BadRequestException('Reset token is invalid');
    }

    const claimedToken = await this.passwordResetTokenModel
      .updateOne(
        {
          _id: resetToken._id,
          usedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
      )
      .exec();
    if (!claimedToken.modifiedCount) {
      throw new BadRequestException('Reset token is invalid');
    }

    try {
      const nextPasswordHash = await hashPassword(password);
      await this.userModel
        .updateOne(
          { _id: user._id },
          { $set: { passwordHash: nextPasswordHash } },
        )
        .exec();
      await this.passwordResetTokenModel
        .updateMany(
          {
            userId: user._id,
            usedAt: null,
            expiresAt: { $gt: now },
          },
          { $set: { usedAt: now } },
        )
        .exec();
      await this.sessionService.clearUserSessions(user._id);
      return {
        message: '密码已重置，请使用新密码登录。',
      };
    } catch (error) {
      this.logger.error(
        `Failed to reset password for user ${user._id.toString()}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to reset password');
    }
  }

  private buildResetUrl(token: string): string {
    const frontendUrl =
      this.configService.get<string>('app.frontendUrl') ??
      'http://localhost:3000';
    const normalizedFrontendUrl = frontendUrl.replace(/\/+$/, '');
    return `${normalizedFrontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
