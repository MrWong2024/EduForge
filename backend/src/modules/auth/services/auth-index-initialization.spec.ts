import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/schemas/user.schema';
import { PasswordResetToken } from '../schemas/password-reset-token.schema';
import { Session } from '../schemas/session.schema';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';

function createModelProvider(modelName: string) {
  const mockIndexMethod = (method: string) =>
    jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined)
      .mockName(`${modelName}.${method}`);

  return {
    provide: getModelToken(modelName),
    useValue: {
      ensureIndexes: mockIndexMethod('ensureIndexes'),
      createIndexes: mockIndexMethod('createIndexes'),
      syncIndexes: mockIndexMethod('syncIndexes'),
      createCollection: mockIndexMethod('createCollection'),
      init: mockIndexMethod('init'),
    },
  };
}

describe('Auth index initialization', () => {
  it('initializes both services without issuing index writes', async () => {
    const modelProviders = [Session, PasswordResetToken, User].map(({ name }) =>
      createModelProvider(name),
    );
    const module = await Test.createTestingModule({
      providers: [
        SessionService,
        PasswordResetService,
        ...modelProviders,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: MailService,
          useValue: { sendPasswordResetEmail: jest.fn() },
        },
      ],
    }).compile();

    try {
      await module.init();

      expect(module.get(SessionService)).toBeInstanceOf(SessionService);
      expect(module.get(PasswordResetService)).toBeInstanceOf(
        PasswordResetService,
      );
      const calledIndexMethods = modelProviders
        .flatMap(({ useValue }) => Object.values(useValue))
        .filter((method) => method.mock.calls.length > 0)
        .map((method) => method.getMockName());
      expect(calledIndexMethods).toEqual([]);
    } finally {
      await module.close();
    }
  });
});
