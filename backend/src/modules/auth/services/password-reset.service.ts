import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { MailService } from '../../mail/mail.service';
import { User, UserStatus } from '../../users/schemas/user.schema';
import {
  canUserAuthenticate,
  hashPassword,
  validateNewPassword,
} from '../../users/password.utils';
import { PasswordResetToken } from '../schemas/password-reset-token.schema';
import { SessionService } from './session.service';

type ResetRequestUser = Pick<User, 'email' | 'status' | 'credentialVersion'> & {
  _id: Types.ObjectId;
};
type OccupiedResetRequestUser = Pick<
  ResetRequestUser,
  '_id' | 'email' | 'credentialVersion'
> & {
  passwordResetRequestedAt: Date;
};
type ClaimedResetToken = Pick<
  PasswordResetToken,
  'userId' | 'credentialVersion' | 'requestedAt'
>;

@Injectable()
export class PasswordResetService {
  private static readonly REQUEST_COOLDOWN_MS = 60 * 1000;
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

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .select('_id email status credentialVersion')
      .lean<ResetRequestUser>()
      .exec();
    if (!user || !canUserAuthenticate(user.status)) {
      return this.genericForgotPasswordResponse;
    }

    const now = new Date();
    const cooldownSince = new Date(
      now.getTime() - PasswordResetService.REQUEST_COOLDOWN_MS,
    );
    const occupiedUser = await this.userModel
      .findOneAndUpdate(
        {
          _id: user._id,
          status: UserStatus.Active,
          credentialVersion: user.credentialVersion,
          $or: [
            { passwordResetRequestedAt: null },
            { passwordResetRequestedAt: { $lte: cooldownSince } },
          ],
        },
        { $set: { passwordResetRequestedAt: now } },
        { returnDocument: 'after', runValidators: true },
      )
      .select('_id email credentialVersion passwordResetRequestedAt')
      .lean<OccupiedResetRequestUser>()
      .exec();
    if (!occupiedUser) {
      return this.genericForgotPasswordResponse;
    }

    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date(
      now.getTime() + this.resetTokenTtlMinutes * 60 * 1000,
    );
    const resetToken = await this.passwordResetTokenModel.create({
      userId: occupiedUser._id,
      email: occupiedUser.email,
      tokenHash,
      expiresAt,
      credentialVersion: occupiedUser.credentialVersion,
      requestedAt: occupiedUser.passwordResetRequestedAt,
    });

    await this.passwordResetTokenModel
      .updateMany(
        {
          userId: occupiedUser._id,
          requestedAt: { $lt: occupiedUser.passwordResetRequestedAt },
          usedAt: null,
        },
        { $set: { usedAt: now } },
      )
      .exec();

    try {
      await this.mailService.sendPasswordResetEmail({
        to: occupiedUser.email,
        resetUrl: this.buildResetUrl(plainToken),
        expiresInMinutes: this.resetTokenTtlMinutes,
      });
    } catch {
      this.logger.error('Failed to send password reset email');
      try {
        await this.passwordResetTokenModel
          .updateOne(
            { _id: resetToken._id, usedAt: null },
            { $set: { usedAt: new Date() } },
          )
          .exec();
      } catch {
        this.logger.error(
          'Failed to invalidate the unsent password reset token',
        );
      }
    }

    return this.genericForgotPasswordResponse;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const normalizedToken = token.trim();
    const password = validateNewPassword(newPassword);
    const tokenHash = this.hashToken(normalizedToken);
    const validToken = await this.passwordResetTokenModel
      .findOne({
        tokenHash,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .select('userId credentialVersion requestedAt')
      .lean<ClaimedResetToken>()
      .exec();
    if (!validToken) {
      throw this.invalidResetToken();
    }

    const currentUser = await this.userModel
      .findOne({
        _id: validToken.userId,
        status: UserStatus.Active,
        credentialVersion: validToken.credentialVersion,
        passwordResetRequestedAt: validToken.requestedAt,
      })
      .select('_id')
      .lean()
      .exec();
    if (!currentUser) {
      throw this.invalidResetToken();
    }

    const nextPasswordHash = await hashPassword(password);
    const now = new Date();
    const resetToken = await this.passwordResetTokenModel
      .findOneAndUpdate(
        {
          tokenHash,
          usedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
        { returnDocument: 'after' },
      )
      .select('userId credentialVersion requestedAt')
      .lean<ClaimedResetToken>()
      .exec();
    if (!resetToken) {
      throw this.invalidResetToken();
    }

    const updatedUser = await this.userModel
      .updateOne(
        {
          _id: resetToken.userId,
          status: UserStatus.Active,
          credentialVersion: resetToken.credentialVersion,
          passwordResetRequestedAt: resetToken.requestedAt,
        },
        {
          $set: { passwordHash: nextPasswordHash },
          $inc: { credentialVersion: 1 },
        },
      )
      .exec();
    if (updatedUser.modifiedCount !== 1) {
      throw this.invalidResetToken();
    }

    const nextVersion = resetToken.credentialVersion + 1;
    await this.passwordResetTokenModel
      .updateMany(
        {
          userId: resetToken.userId,
          credentialVersion: { $lt: nextVersion },
          usedAt: null,
        },
        { $set: { usedAt: now } },
      )
      .exec();
    await this.sessionService.clearUserSessionsBeforeVersion(
      resetToken.userId.toString(),
      nextVersion,
    );
    return { message: '密码已重置，请使用新密码登录。' };
  }

  private invalidResetToken(): BadRequestException {
    return new BadRequestException({
      message: 'Reset token is invalid',
      code: 'RESET_TOKEN_INVALID',
    });
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
