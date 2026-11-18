import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { MailService } from '../../mail/mail.service';
import { UserStatus } from '../../users/schemas/user.schema';
import { hashPassword } from '../../users/password.utils';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

jest.mock('../../users/password.utils', () => {
  const actual = jest.requireActual<
    typeof import('../../users/password.utils')
  >('../../users/password.utils');
  return {
    ...actual,
    hashPassword: jest.fn().mockResolvedValue('synthetic-password-hash'),
  };
});

const NOW = new Date('2099-01-01T00:00:00.000Z');
const GENERIC_RESPONSE = { message: '如果邮箱存在，我们将发送密码重置邮件。' };

type RequestUser = {
  _id: Types.ObjectId;
  email: string;
  status: UserStatus;
  credentialVersion: number;
  passwordResetRequestedAt: Date | null;
};
type ClaimedToken = {
  userId: Types.ObjectId;
  credentialVersion: number;
  requestedAt: Date;
};
type ServiceOptions = {
  user?: RequestUser | null;
  occupy?: boolean;
  token?: boolean;
  currentUser?: boolean;
  claim?: boolean;
  updateUser?: boolean;
};

const query = <T>(value: T) => {
  const result = { exec: jest.fn<Promise<T>, []>().mockResolvedValue(value) };
  return {
    select: jest.fn(() => ({ lean: jest.fn(() => result) })),
    lean: jest.fn(() => result),
  };
};
const write = (modifiedCount = 1) => ({
  exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount }),
});

describe('PasswordResetService (no I/O)', () => {
  const createService = (options: ServiceOptions = {}) => {
    const userId = new Types.ObjectId();
    const resetTokenId = new Types.ObjectId();
    const defaultUser: RequestUser = {
      _id: userId,
      email: 'teacher@example.invalid',
      status: UserStatus.Active,
      credentialVersion: 3,
      passwordResetRequestedAt: null,
    };
    const user = options.user === undefined ? defaultUser : options.user;
    const occupiedUser =
      options.occupy === false || !user
        ? null
        : { ...user, passwordResetRequestedAt: NOW };
    const validToken: ClaimedToken = {
      userId,
      credentialVersion: 3,
      requestedAt: NOW,
    };
    const claimedToken = options.claim === false ? null : validToken;
    const findToken = jest.fn((_filter: Record<string, unknown>) => {
      void _filter;
      return query(options.token === false ? null : validToken);
    });
    const findUser = jest.fn((_filter: Record<string, unknown>) => {
      void _filter;
      return query(options.currentUser === false ? null : user);
    });
    const occupyUser = jest.fn(
      (_filter: Record<string, unknown>, _update: Record<string, unknown>) => {
        void _filter;
        void _update;
        return query(occupiedUser);
      },
    );
    const updateUser = jest.fn(
      (_filter: Record<string, unknown>, _update: Record<string, unknown>) => {
        void _filter;
        void _update;
        return write(options.updateUser === false ? 0 : 1);
      },
    );
    const createToken = jest
      .fn<Promise<{ _id: Types.ObjectId }>, [Record<string, unknown>]>()
      .mockResolvedValue({ _id: resetTokenId });
    const claimToken = jest.fn(
      (_filter: Record<string, unknown>, _update: Record<string, unknown>) => {
        void _filter;
        void _update;
        return query(claimedToken);
      },
    );
    const invalidateTokens = jest.fn(
      (_filter: Record<string, unknown>, _update: Record<string, unknown>) => {
        void _filter;
        void _update;
        return write();
      },
    );
    const invalidateToken = jest.fn(
      (_filter: Record<string, unknown>, _update: Record<string, unknown>) => {
        void _filter;
        void _update;
        return write();
      },
    );
    const sendPasswordResetEmail = jest
      .fn<
        Promise<void>,
        [Parameters<MailService['sendPasswordResetEmail']>[0]]
      >()
      .mockResolvedValue(undefined);
    const clearUserSessionsBeforeVersion = jest
      .fn<Promise<void>, [string, number]>()
      .mockResolvedValue(undefined);
    const service = new PasswordResetService(
      new ConfigService({
        app: { frontendUrl: 'https://frontend.example.invalid/' },
      }),
      { sendPasswordResetEmail } as unknown as MailService,
      { clearUserSessionsBeforeVersion } as unknown as SessionService,
      {
        findOne: findUser,
        findOneAndUpdate: occupyUser,
        updateOne: updateUser,
      } as never,
      {
        create: createToken,
        findOne: findToken,
        findOneAndUpdate: claimToken,
        updateMany: invalidateTokens,
        updateOne: invalidateToken,
      } as never,
    );
    return {
      service,
      userId,
      resetTokenId,
      mocks: {
        findUser,
        occupyUser,
        updateUser,
        createToken,
        findToken,
        claimToken,
        invalidateTokens,
        invalidateToken,
        sendPasswordResetEmail,
        clearUserSessionsBeforeVersion,
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns the generic response without issuing a token for an unknown email', async () => {
    const harness = createService({ user: null });
    await expect(
      harness.service.requestPasswordReset('missing@example.invalid'),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.occupyUser).not.toHaveBeenCalled();
    expect(harness.mocks.createToken).not.toHaveBeenCalled();
    expect(harness.mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns the same response for a suspended account', async () => {
    const harness = createService({
      user: {
        _id: new Types.ObjectId(),
        email: 'suspended@example.invalid',
        status: UserStatus.Suspended,
        credentialVersion: 4,
        passwordResetRequestedAt: null,
      },
    });
    await expect(
      harness.service.requestPasswordReset('suspended@example.invalid'),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.occupyUser).not.toHaveBeenCalled();
    expect(harness.mocks.createToken).not.toHaveBeenCalled();
  });

  it('occupies the user cooldown atomically and copies its time and version to the token', async () => {
    const harness = createService();
    await expect(
      harness.service.requestPasswordReset(' Teacher@Example.Invalid '),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.findUser).toHaveBeenCalledWith({
      email: 'teacher@example.invalid',
    });
    expect(harness.mocks.occupyUser).toHaveBeenCalledWith(
      {
        _id: harness.userId,
        status: UserStatus.Active,
        credentialVersion: 3,
        $or: [
          { passwordResetRequestedAt: null },
          {
            passwordResetRequestedAt: {
              $lte: new Date(NOW.getTime() - 60_000),
            },
          },
        ],
      },
      { $set: { passwordResetRequestedAt: NOW } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(harness.mocks.createToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: harness.userId,
        credentialVersion: 3,
        requestedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      }),
    );
    expect(harness.mocks.invalidateTokens).toHaveBeenCalledWith(
      { userId: harness.userId, requestedAt: { $lt: NOW }, usedAt: null },
      { $set: { usedAt: NOW } },
    );
    const email = harness.mocks.sendPasswordResetEmail.mock.calls[0]?.[0];
    const created = harness.mocks.createToken.mock.calls[0]?.[0];
    if (!email || !created) {
      throw new Error('Expected a reset email and token');
    }
    const resetUrl = new URL(email.resetUrl);
    const mailedToken = resetUrl.searchParams.get('token');
    expect(resetUrl.pathname).toBe('/reset-password');
    expect(
      typeof mailedToken === 'string' && /^[a-f0-9]{64}$/.test(mailedToken),
    ).toBe(true);
    expect(
      created.tokenHash ===
        createHash('sha256')
          .update(mailedToken ?? '')
          .digest('hex'),
    ).toBe(true);
  });

  it('does not issue, invalidate or email tokens when the cooldown CAS loses', async () => {
    const harness = createService({ occupy: false });
    await expect(
      harness.service.requestPasswordReset('teacher@example.invalid'),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.createToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('keeps the same cooldown predicate when the clock moves backwards', async () => {
    const harness = createService({ occupy: false });
    const earlier = new Date(NOW.getTime() - 30_000);
    jest.setSystemTime(earlier);
    await harness.service.requestPasswordReset('teacher@example.invalid');
    expect(harness.mocks.occupyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { passwordResetRequestedAt: null },
          {
            passwordResetRequestedAt: {
              $lte: new Date(earlier.getTime() - 60_000),
            },
          },
        ],
      }),
      { $set: { passwordResetRequestedAt: earlier } },
      expect.any(Object),
    );
    expect(harness.mocks.createToken).not.toHaveBeenCalled();
  });

  it('only invalidates this token on mail failure and leaves the cooldown occupied', async () => {
    const harness = createService();
    harness.mocks.sendPasswordResetEmail.mockRejectedValue(
      new Error('Synthetic mail failure'),
    );
    await expect(
      harness.service.requestPasswordReset('teacher@example.invalid'),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.invalidateToken).toHaveBeenCalledWith(
      { _id: harness.resetTokenId, usedAt: null },
      { $set: { usedAt: NOW } },
    );
    expect(harness.mocks.occupyUser).toHaveBeenCalledTimes(1);
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
  });

  it('preserves the generic mail-failure response even if token invalidation fails', async () => {
    const harness = createService();
    harness.mocks.sendPasswordResetEmail.mockRejectedValue(
      new Error('Synthetic mail failure'),
    );
    harness.mocks.invalidateToken.mockImplementation(() => ({
      exec: jest.fn().mockRejectedValue(new Error('Synthetic cleanup failure')),
    }));
    await expect(
      harness.service.requestPasswordReset('teacher@example.invalid'),
    ).resolves.toEqual(GENERIC_RESPONSE);
    expect(harness.mocks.occupyUser).toHaveBeenCalledTimes(1);
  });

  it('checks token and current user before hashing, then claims and performs the final user CAS', async () => {
    const harness = createService();
    await expect(
      harness.service.resetPassword(' synthetic-token ', '  NextPass123!  '),
    ).resolves.toEqual({
      message: '密码已重置，请使用新密码登录。',
    });
    const tokenFilter = harness.mocks.findToken.mock.calls[0]?.[0];
    expect(tokenFilter?.usedAt).toBeNull();
    expect(tokenFilter?.expiresAt).toEqual({ $gt: NOW });
    expect(
      tokenFilter?.tokenHash ===
        createHash('sha256').update('synthetic-token').digest('hex'),
    ).toBe(true);
    expect(harness.mocks.findUser).toHaveBeenCalledWith({
      _id: harness.userId,
      status: UserStatus.Active,
      credentialVersion: 3,
      passwordResetRequestedAt: NOW,
    });
    expect(hashPassword).toHaveBeenCalledWith('NextPass123!');
    expect(harness.mocks.claimToken).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: null, expiresAt: { $gt: NOW } }),
      { $set: { usedAt: NOW } },
      { returnDocument: 'after' },
    );
    expect(harness.mocks.updateUser).toHaveBeenCalledWith(
      {
        _id: harness.userId,
        status: UserStatus.Active,
        credentialVersion: 3,
        passwordResetRequestedAt: NOW,
      },
      {
        $set: { passwordHash: 'synthetic-password-hash' },
        $inc: { credentialVersion: 1 },
      },
    );
    expect(harness.mocks.invalidateTokens).toHaveBeenCalledWith(
      { userId: harness.userId, credentialVersion: { $lt: 4 }, usedAt: null },
      { $set: { usedAt: NOW } },
    );
    expect(harness.mocks.clearUserSessionsBeforeVersion).toHaveBeenCalledWith(
      harness.userId.toString(),
      4,
    );
    const hashOrder = jest.mocked(hashPassword).mock.invocationCallOrder[0];
    const tokenReadOrder = harness.mocks.findToken.mock.invocationCallOrder[0];
    const userReadOrder = harness.mocks.findUser.mock.invocationCallOrder[0];
    const claimOrder = harness.mocks.claimToken.mock.invocationCallOrder[0];
    const userCasOrder = harness.mocks.updateUser.mock.invocationCallOrder[0];
    expect(tokenReadOrder).toBeLessThan(userReadOrder);
    expect(userReadOrder).toBeLessThan(hashOrder);
    expect(hashOrder).toBeLessThan(claimOrder);
    expect(claimOrder).toBeLessThan(userCasOrder);
  });

  it('preserves password-policy priority before token lookup or hashing', async () => {
    const harness = createService({ token: false });
    await expect(
      harness.service.resetPassword('synthetic-token', 'short'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'PASSWORD_POLICY_VIOLATION' },
    });
    expect(harness.mocks.findToken).not.toHaveBeenCalled();
    expect(harness.mocks.findUser).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(harness.mocks.claimToken).not.toHaveBeenCalled();
  });

  it('rejects a missing valid-token lookup before hashing or changing any credentials', async () => {
    const harness = createService({ token: false });
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Reset token is invalid',
        code: 'RESET_TOKEN_INVALID',
      },
    });
    expect(harness.mocks.findToken).toHaveBeenCalledTimes(1);
    expect(harness.mocks.findUser).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(harness.mocks.claimToken).not.toHaveBeenCalled();
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });

  it('rejects a missing matching active user before hashing or changing any credentials', async () => {
    const harness = createService({ currentUser: false });
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Reset token is invalid',
        code: 'RESET_TOKEN_INVALID',
      },
    });
    expect(harness.mocks.findUser).toHaveBeenCalledWith({
      _id: harness.userId,
      status: UserStatus.Active,
      credentialVersion: 3,
      passwordResetRequestedAt: NOW,
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(harness.mocks.claimToken).not.toHaveBeenCalled();
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });

  it('does not claim a token when preparing its new password hash fails', async () => {
    const harness = createService();
    jest
      .mocked(hashPassword)
      .mockRejectedValueOnce(new Error('Synthetic hashing failure'));
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toThrow('Synthetic hashing failure');
    expect(harness.mocks.findToken).toHaveBeenCalledTimes(1);
    expect(harness.mocks.findUser).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(harness.mocks.claimToken).not.toHaveBeenCalled();
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });

  it('uses the current time after hashing to reject a token that expired during hashing', async () => {
    const harness = createService({ claim: false });
    const afterHash = new Date(NOW.getTime() + 30 * 60_000);
    jest.mocked(hashPassword).mockImplementationOnce(() => {
      jest.setSystemTime(afterHash);
      return Promise.resolve('synthetic-password-hash');
    });
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Reset token is invalid',
        code: 'RESET_TOKEN_INVALID',
      },
    });
    expect(harness.mocks.findToken.mock.calls[0]?.[0].expiresAt).toEqual({
      $gt: NOW,
    });
    expect(harness.mocks.claimToken.mock.calls[0]?.[0].expiresAt).toEqual({
      $gt: afterHash,
    });
    expect(harness.mocks.claimToken.mock.calls[0]?.[1]).toEqual({
      $set: { usedAt: afterHash },
    });
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });

  it('returns the public invalid-token error when claim loses after valid prechecks', async () => {
    const harness = createService({ claim: false });
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Reset token is invalid',
        code: 'RESET_TOKEN_INVALID',
      },
    });
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(harness.mocks.claimToken).toHaveBeenCalledTimes(1);
    expect(harness.mocks.updateUser).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });

  it('returns the public invalid-token error after a claim succeeds but the final user CAS loses', async () => {
    const harness = createService({ updateUser: false });
    await expect(
      harness.service.resetPassword('synthetic-token', 'NextPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Reset token is invalid',
        code: 'RESET_TOKEN_INVALID',
      },
    });
    expect(harness.mocks.claimToken).toHaveBeenCalledTimes(1);
    expect(harness.mocks.invalidateToken).not.toHaveBeenCalled();
    expect(harness.mocks.invalidateTokens).not.toHaveBeenCalled();
    expect(harness.mocks.clearUserSessionsBeforeVersion).not.toHaveBeenCalled();
  });
});
