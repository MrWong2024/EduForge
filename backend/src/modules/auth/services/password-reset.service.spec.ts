import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

const FIXED_TOKEN =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomBytes: jest.fn(() => Buffer.from(FIXED_TOKEN, 'hex')),
  };
});

import * as crypto from 'crypto';
import { MailService } from '../../mail/mail.service';
import { UserStatus } from '../../users/schemas/user.schema';
import { comparePassword } from '../../users/password.utils';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

type ResetUser = {
  _id: Types.ObjectId;
  email: string;
  status: UserStatus;
};

type ResetTokenRecord = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

type RecentResetTokenRecord = {
  _id: Types.ObjectId;
  createdAt: Date;
};

type MongoWriteResult = {
  acknowledged: true;
  modifiedCount: number;
};

type UpdateUserPayload = {
  $set: {
    passwordHash: string;
  };
};

type ServiceOptions = {
  recentResetToken?: RecentResetTokenRecord | null;
  resetToken?: ResetTokenRecord | null;
  updateClaimModifiedCount?: number;
  user?: ResetUser | null;
  userById?: ResetUser | null;
};

const FIXED_NOW = new Date('2099-01-01T00:00:00.000Z');
const createExec = <T>(value: T): jest.Mock<Promise<T>, []> =>
  jest.fn<Promise<T>, []>().mockResolvedValue(value);

const buildTokenHash = () =>
  crypto.createHash('sha256').update(FIXED_TOKEN).digest('hex');

describe('PasswordResetService', () => {
  const createService = (options: ServiceOptions = {}) => {
    const userId = new Types.ObjectId();
    const resetTokenId = new Types.ObjectId();
    const user: ResetUser | null =
      options.user === undefined
        ? {
            _id: userId,
            email: 'teacher@example.com',
            status: UserStatus.Active,
          }
        : options.user;
    const userById: ResetUser | null =
      options.userById === undefined ? user : options.userById;
    const recentResetToken: RecentResetTokenRecord | null =
      options.recentResetToken === undefined ? null : options.recentResetToken;
    const resetToken: ResetTokenRecord | null =
      options.resetToken === undefined
        ? {
            _id: resetTokenId,
            userId,
            email: 'teacher@example.com',
            tokenHash: buildTokenHash(),
            expiresAt: new Date('2099-01-01T00:30:00.000Z'),
            usedAt: null,
          }
        : options.resetToken;

    const sendPasswordResetEmail = jest
      .fn<
        Promise<void>,
        [Parameters<MailService['sendPasswordResetEmail']>[0]]
      >()
      .mockResolvedValue(undefined);
    const clearUserSessions = jest
      .fn<Promise<void>, [Types.ObjectId | string, (string | undefined)?]>()
      .mockResolvedValue(undefined);
    const configGet = jest.fn((key: string) => {
      if (key === 'app.frontendUrl') {
        return 'https://frontend.example.com';
      }
      return undefined;
    });

    const findUserByEmailExec = createExec(user);
    const findUserByIdExec = createExec(userById);
    const updateUserExec = createExec<MongoWriteResult>({
      acknowledged: true,
      modifiedCount: 1,
    });
    const resetTokenCreatedAt = new Date('2099-01-01T00:00:00.000Z');
    const createResetToken = jest
      .fn<
        Promise<{ _id: Types.ObjectId; createdAt: Date }>,
        [Record<string, unknown>]
      >()
      .mockResolvedValue({ _id: resetTokenId, createdAt: resetTokenCreatedAt });
    const findPasswordResetToken = jest.fn((query: Record<string, unknown>) => {
      const execMock =
        'tokenHash' in query
          ? createExec(resetToken)
          : createExec(
              recentResetToken &&
                query.userId instanceof Types.ObjectId &&
                query.userId.equals(userId) &&
                query.createdAt &&
                typeof query.createdAt === 'object' &&
                '$gte' in query.createdAt &&
                query.createdAt.$gte instanceof Date &&
                recentResetToken.createdAt >= query.createdAt.$gte
                ? recentResetToken
                : null,
            );
      const leanChain = {
        exec: execMock,
      };
      return {
        select: jest.fn(() => ({
          lean: jest.fn(() => leanChain),
        })),
        lean: jest.fn(() => leanChain),
      };
    });
    const claimTokenExec = createExec<MongoWriteResult>({
      acknowledged: true,
      modifiedCount: options.updateClaimModifiedCount ?? 1,
    });
    const invalidateTokensExec = createExec<MongoWriteResult>({
      acknowledged: true,
      modifiedCount: 1,
    });

    const updateUser = jest.fn<
      { exec: jest.Mock<Promise<MongoWriteResult>, []> },
      [{ _id: Types.ObjectId }, UpdateUserPayload]
    >(() => ({
      exec: updateUserExec,
    }));
    const markTokenUsed = jest.fn<
      { exec: jest.Mock<Promise<MongoWriteResult>, []> },
      [Record<string, unknown>, { $set: { usedAt: Date } }]
    >(() => ({
      exec: claimTokenExec,
    }));
    const invalidateTokens = jest.fn<
      { exec: jest.Mock<Promise<MongoWriteResult>, []> },
      [Record<string, unknown>, { $set: { usedAt: Date } }]
    >(() => ({
      exec: invalidateTokensExec,
    }));

    const userModel = {
      findOne: jest.fn(() => ({
        lean: jest.fn(() => ({
          exec: findUserByEmailExec,
        })),
      })),
      findById: jest.fn(() => ({
        lean: jest.fn(() => ({
          exec: findUserByIdExec,
        })),
      })),
      updateOne: updateUser,
    };
    const passwordResetTokenModel = {
      ensureIndexes: jest.fn().mockResolvedValue(undefined),
      create: createResetToken,
      findOne: findPasswordResetToken,
      updateOne: markTokenUsed,
      updateMany: invalidateTokens,
    };

    const service = new PasswordResetService(
      {
        get: configGet,
      } as unknown as ConfigService,
      {
        sendPasswordResetEmail,
      } as unknown as MailService,
      {
        clearUserSessions,
      } as unknown as SessionService,
      userModel as never,
      passwordResetTokenModel as never,
    );

    return {
      service,
      mocks: {
        clearUserSessions,
        createResetToken,
        findPasswordResetToken,
        invalidateTokens,
        markTokenUsed,
        sendPasswordResetEmail,
        updateUser,
      },
      userId,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns generic success without token creation when email is unknown', async () => {
    const harness = createService({ user: null });

    await expect(
      harness.service.requestPasswordReset('missing@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });
    expect(harness.mocks.createResetToken).not.toHaveBeenCalled();
    expect(harness.mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns generic success without token creation when user cannot authenticate', async () => {
    const harness = createService({
      user: {
        _id: new Types.ObjectId(),
        email: 'suspended@example.com',
        status: UserStatus.Suspended,
      },
    });

    await expect(
      harness.service.requestPasswordReset('suspended@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });
    expect(harness.mocks.createResetToken).not.toHaveBeenCalled();
    expect(harness.mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('creates hashed token, invalidates old active tokens, and emails reset link', async () => {
    const harness = createService();

    await expect(
      harness.service.requestPasswordReset('teacher@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });

    expect(harness.mocks.createResetToken).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'teacher@example.com',
        tokenHash: buildTokenHash(),
      }),
    );
    expect(harness.mocks.invalidateTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: harness.userId,
        createdAt: { $lt: new Date('2099-01-01T00:00:00.000Z') },
        usedAt: null,
      }),
      expect.any(Object),
    );
    const invalidatePayload = harness.mocks.invalidateTokens.mock.calls[0]?.[1];
    expect(invalidatePayload).toBeDefined();
    if (!invalidatePayload) {
      throw new Error('Expected invalidateTokens to receive a usedAt payload');
    }
    expect(invalidatePayload.$set.usedAt).toBeInstanceOf(Date);
    expect(harness.mocks.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: 'teacher@example.com',
      resetUrl: `https://frontend.example.com/reset-password?token=${FIXED_TOKEN}`,
      expiresInMinutes: 30,
    });
  });

  it('returns generic success during cooldown without creating token, invalidating token, or sending mail', async () => {
    const harness = createService({
      recentResetToken: {
        _id: new Types.ObjectId(),
        createdAt: new Date(FIXED_NOW.getTime() - 30 * 1000),
      },
    });

    await expect(
      harness.service.requestPasswordReset('teacher@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });

    expect(harness.mocks.findPasswordResetToken).toHaveBeenCalledWith({
      userId: harness.userId,
      createdAt: { $gte: new Date(FIXED_NOW.getTime() - 60 * 1000) },
    });
    expect(harness.mocks.createResetToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.markTokenUsed).not.toHaveBeenCalled();
    expect(harness.mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('allows another forgot-password request after cooldown window passes', async () => {
    const harness = createService({
      recentResetToken: {
        _id: new Types.ObjectId(),
        createdAt: new Date(FIXED_NOW.getTime() - 61 * 1000),
      },
    });

    await expect(
      harness.service.requestPasswordReset('teacher@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });

    expect(harness.mocks.createResetToken).toHaveBeenCalledTimes(1);
    expect(harness.mocks.invalidateTokens).toHaveBeenCalledTimes(1);
    expect(harness.mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('invalidates the fresh token when email sending fails but still returns generic success', async () => {
    const harness = createService();
    harness.mocks.sendPasswordResetEmail.mockRejectedValue(
      new Error('smtp down'),
    );

    await expect(
      harness.service.requestPasswordReset('teacher@example.com'),
    ).resolves.toEqual({
      message: '如果邮箱存在，我们将发送密码重置邮件。',
    });
    expect(harness.mocks.markTokenUsed).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
    );
    const failedMailTokenFilter =
      harness.mocks.markTokenUsed.mock.calls[0]?.[0];
    const failedMailTokenPayload =
      harness.mocks.markTokenUsed.mock.calls[0]?.[1];
    expect(failedMailTokenFilter).toBeDefined();
    expect(failedMailTokenPayload).toBeDefined();
    if (!failedMailTokenFilter || !failedMailTokenPayload) {
      throw new Error(
        'Expected markTokenUsed to be called for failed mail send',
      );
    }
    expect(failedMailTokenFilter._id).toBeInstanceOf(Types.ObjectId);
    expect(failedMailTokenPayload.$set.usedAt).toBeInstanceOf(Date);
  });

  it('updates password, marks token used, and clears sessions on valid reset', async () => {
    const harness = createService();

    await expect(
      harness.service.resetPassword(FIXED_TOKEN, '  NextPass123!  '),
    ).resolves.toEqual({
      message: '密码已重置，请使用新密码登录。',
    });

    expect(harness.mocks.markTokenUsed).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
    );
    const claimFilter = harness.mocks.markTokenUsed.mock.calls[0]?.[0];
    const claimPayload = harness.mocks.markTokenUsed.mock.calls[0]?.[1];
    expect(claimFilter).toBeDefined();
    expect(claimPayload).toBeDefined();
    if (!claimFilter || !claimPayload) {
      throw new Error('Expected markTokenUsed to claim the active reset token');
    }
    expect(claimFilter._id).toBeInstanceOf(Types.ObjectId);
    expect(claimFilter.usedAt).toBeNull();
    expect(claimPayload.$set.usedAt).toBeInstanceOf(Date);
    expect(harness.mocks.updateUser).toHaveBeenCalledWith(
      { _id: harness.userId },
      expect.any(Object),
    );
    const updatePayload = harness.mocks.updateUser.mock.calls[0]?.[1];
    expect(updatePayload).toBeDefined();
    if (!updatePayload) {
      throw new Error('Expected updateUser to receive a password hash payload');
    }
    const passwordHash = updatePayload.$set.passwordHash;
    expect(typeof passwordHash).toBe('string');
    await expect(comparePassword('NextPass123!', passwordHash)).resolves.toBe(
      true,
    );
    expect(harness.mocks.clearUserSessions).toHaveBeenCalledWith(
      harness.userId,
    );
  });

  it('rejects expired token', async () => {
    const harness = createService({
      resetToken: {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        email: 'teacher@example.com',
        tokenHash: buildTokenHash(),
        expiresAt: new Date('2025-01-01T00:00:00.000Z'),
        usedAt: null,
      },
    });

    await expect(
      harness.service.resetPassword(FIXED_TOKEN, 'NextPass123!'),
    ).rejects.toThrow(BadRequestException);
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessions).not.toHaveBeenCalled();
  });

  it('rejects used token', async () => {
    const harness = createService({
      resetToken: {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        email: 'teacher@example.com',
        tokenHash: buildTokenHash(),
        expiresAt: new Date('2099-01-01T00:30:00.000Z'),
        usedAt: new Date('2026-01-01T00:05:00.000Z'),
      },
    });

    await expect(
      harness.service.resetPassword(FIXED_TOKEN, 'NextPass123!'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown token', async () => {
    const harness = createService({ resetToken: null });

    await expect(
      harness.service.resetPassword(FIXED_TOKEN, 'NextPass123!'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when token claim races with another request', async () => {
    const harness = createService({ updateClaimModifiedCount: 0 });

    await expect(
      harness.service.resetPassword(FIXED_TOKEN, 'NextPass123!'),
    ).rejects.toThrow(BadRequestException);
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
  });
});
