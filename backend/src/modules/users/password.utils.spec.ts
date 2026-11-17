import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { USER_PASSWORD_HASH_ROUNDS } from './password.constants';
import {
  comparePassword,
  hashPassword,
  validateCurrentPassword,
  validateLoginPassword,
  validateNewPassword,
} from './password.utils';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('synthetic-password-hash'),
  compare: jest.fn().mockResolvedValue(true),
}));

const expectPolicyViolation = (action: () => unknown): void => {
  try {
    action();
    throw new Error('Expected password policy rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'PASSWORD_POLICY_VIOLATION' }),
    );
  }
};

describe('Password policy (no I/O)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trims new passwords and counts Unicode code points', () => {
    expect(validateNewPassword('  Abcd1234  ')).toBe('Abcd1234');
    expect(validateNewPassword('😀'.repeat(8))).toBe('😀'.repeat(8));
    expectPolicyViolation(() => validateNewPassword('1234567'));
    expectPolicyViolation(() => validateNewPassword('😀'.repeat(7)));
    expectPolicyViolation(() => validateNewPassword('        '));
  });

  it.each(['a'.repeat(72), '汉'.repeat(24), '😀'.repeat(18)])(
    'accepts a new password at the UTF-8 byte boundary',
    (password) => {
      expect(validateNewPassword(password)).toBe(password);
    },
  );

  it.each(['a'.repeat(73), '汉'.repeat(25), '😀'.repeat(19)])(
    'rejects a new password above the UTF-8 byte boundary',
    (password) => {
      expectPolicyViolation(() => validateNewPassword(password));
    },
  );

  it('preserves login and current password input without trimming', () => {
    expect(validateLoginPassword('  abcd')).toBe('  abcd');
    expect(validateLoginPassword('😀'.repeat(6))).toBe('😀'.repeat(6));
    expect(validateCurrentPassword(' ')).toBe(' ');
    expect(validateCurrentPassword('😀')).toBe('😀');
    expectPolicyViolation(() => validateLoginPassword('😀'.repeat(5)));
    expectPolicyViolation(() => validateCurrentPassword(''));
  });

  it('applies the same byte limit to login and current passwords', () => {
    expect(validateLoginPassword('a'.repeat(72))).toHaveLength(72);
    expect(validateCurrentPassword('汉'.repeat(24))).toBe('汉'.repeat(24));
    expectPolicyViolation(() => validateLoginPassword('a'.repeat(73)));
    expectPolicyViolation(() => validateCurrentPassword('汉'.repeat(25)));
  });

  it('normalizes and validates every hash input before bcrypt', async () => {
    await hashPassword('  Abcd1234  ');
    expect(bcrypt.hash).toHaveBeenCalledWith(
      'Abcd1234',
      USER_PASSWORD_HASH_ROUNDS,
    );
    jest.clearAllMocks();
    await expect(hashPassword('a'.repeat(73))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('compares original input and never sends oversized input to bcrypt', async () => {
    await comparePassword('  abcd', 'synthetic-password-hash');
    expect(bcrypt.compare).toHaveBeenCalledWith(
      '  abcd',
      'synthetic-password-hash',
    );
    jest.clearAllMocks();
    await expect(
      comparePassword('a'.repeat(73), 'synthetic-password-hash'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});
