import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  USER_PASSWORD_HASH_ROUNDS,
  USER_CURRENT_PASSWORD_MIN_LENGTH,
  USER_LOGIN_PASSWORD_MIN_LENGTH,
  USER_PASSWORD_MAX_BYTES,
  USER_PASSWORD_MIN_LENGTH,
} from './password.constants';
import { UserStatus } from './schemas/user.schema';

export const normalizePasswordInput = (value: string): string => value.trim();

const passwordPolicyViolation = (message: string): BadRequestException =>
  new BadRequestException({ message, code: 'PASSWORD_POLICY_VIOLATION' });

const validatePasswordBytes = (value: string, fieldName: string): void => {
  if (Buffer.byteLength(value, 'utf8') > USER_PASSWORD_MAX_BYTES) {
    throw passwordPolicyViolation(
      `${fieldName} must not exceed ${USER_PASSWORD_MAX_BYTES} UTF-8 bytes`,
    );
  }
};

const validatePassword = (
  value: string,
  minimumCodePoints: number,
  fieldName: string,
): string => {
  validatePasswordBytes(value, fieldName);
  if (Array.from(value).length < minimumCodePoints) {
    throw passwordPolicyViolation(
      `${fieldName} must be at least ${minimumCodePoints} Unicode code points`,
    );
  }
  return value;
};

export const validateNewPassword = (
  value: string,
  fieldName = 'New password',
): string => {
  return validatePassword(
    normalizePasswordInput(value),
    USER_PASSWORD_MIN_LENGTH,
    fieldName,
  );
};

export const validateLoginPassword = (value: string): string =>
  validatePassword(value, USER_LOGIN_PASSWORD_MIN_LENGTH, 'Password');

export const validateCurrentPassword = (value: string): string =>
  validatePassword(value, USER_CURRENT_PASSWORD_MIN_LENGTH, 'Current password');

export const hashPassword = async (value: string): Promise<string> =>
  bcrypt.hash(validateNewPassword(value), USER_PASSWORD_HASH_ROUNDS);

export const comparePassword = async (
  plainText: string,
  passwordHash: string,
): Promise<boolean> => {
  validatePasswordBytes(plainText, 'Password');
  return bcrypt.compare(plainText, passwordHash);
};

export const canUserAuthenticate = (status?: string): boolean =>
  status === UserStatus.Active;
