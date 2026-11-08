import { mongo } from 'mongoose';
import {
  assertLocalStandardTestAuthentication,
  assertLocalStandardTestEnvironment,
} from '../test/helpers/local-test-database-auth';

const uri = (host = '127.0.0.1:27017', options = '') =>
  `mongodb://root:synthetic-password@${host}/eduforge_test?authSource=admin${options}`;
const environment = {
  nodeEnv: 'test',
  purpose: 'standard_test',
  mongoUri: uri(),
};
const authenticated = {
  ...environment,
  databaseName: 'eduforge_test',
  connectedHost: '127.0.0.1',
  authInfo: {
    authenticatedUsers: [{ user: 'root', db: 'admin' }],
    authenticatedUserRoles: [{ role: 'root', db: 'admin' }],
  },
};

describe('local standard-test database authentication (no connection)', () => {
  it.each(['127.0.0.1', 'localhost', '::1'])(
    'accepts root on %s with omitted, true or false directConnection',
    (host) => {
      const address = host === '::1' ? '[::1]:27017' : host + ':27017';
      for (const option of [
        '',
        '&directConnection=true',
        '&directConnection=false',
      ]) {
        expect(() =>
          assertLocalStandardTestAuthentication({
            ...authenticated,
            mongoUri: uri(address, option),
            connectedHost: host,
          }),
        ).not.toThrow();
      }
    },
  );

  it('parses encoded credentials without opening a connection', () => {
    const connect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('A pure authentication gate must not connect');
      });
    try {
      expect(() =>
        assertLocalStandardTestAuthentication({
          ...authenticated,
          mongoUri:
            'mongodb://%72oot:synthetic%40%3A%2F%23%25@localhost/eduforge_test?authSource=%61dmin',
        }),
      ).not.toThrow();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });

  it.each([
    ['production', 'standard_test'],
    ['test', 'browser_acceptance'],
    ['test', undefined],
  ])('rejects environment %s / %s', (nodeEnv, purpose) => {
    expect(() =>
      assertLocalStandardTestEnvironment({ ...environment, nodeEnv, purpose }),
    ).toThrow('LOCAL_STANDARD_TEST_ENVIRONMENT_REQUIRED');
  });

  it.each<[string, string | undefined]>([
    ['missing', undefined],
    [
      'wrong database',
      uri().replace('/eduforge_test?', '/eduforge_browser_test?'),
    ],
    ['remote', uri('example.invalid:27017')],
    ['lookalike localhost', uri('localhost.example.invalid:27017')],
    ['multiple hosts', uri('localhost:27017,127.0.0.1:27017')],
    ['SRV', uri('localhost').replace('mongodb://', 'mongodb+srv://')],
    ['proxy', uri(undefined, '&proxyHost=example.invalid')],
    ['replica set', uri(undefined, '&replicaSet=synthetic')],
    ['load balancing', uri(undefined, '&loadBalanced=false')],
    ['wrong URI user', uri().replace('root:', 'synthetic-app:')],
    [
      'wrong auth database',
      uri().replace('authSource=admin', 'authSource=eduforge_test'),
    ],
    ['malformed credential', uri().replace('synthetic-password', '%ZZ')],
  ])('rejects %s URI with only a fixed safe error', (_label, mongoUri) => {
    expect(() =>
      assertLocalStandardTestEnvironment({ ...environment, mongoUri }),
    ).toThrow('LOCAL_STANDARD_TEST_URI_REQUIRED');
    try {
      assertLocalStandardTestEnvironment({ ...environment, mongoUri });
    } catch (error) {
      expect(String(error)).toBe(
        'DatabaseGateError: LOCAL_STANDARD_TEST_URI_REQUIRED',
      );
      expect(String(error)).not.toContain('synthetic-password');
      expect(String(error)).not.toContain('mongodb://');
    }
  });

  it.each(['eduforge', 'eduforge_dev', 'eduforge_browser_test', undefined])(
    'rejects actual database %s',
    (databaseName) => {
      expect(() =>
        assertLocalStandardTestAuthentication({
          ...authenticated,
          databaseName,
        }),
      ).toThrow('DATABASE_CONNECTED_NAME_MISMATCH');
    },
  );

  it('rejects a remote connected host despite a local URI', () => {
    expect(() =>
      assertLocalStandardTestAuthentication({
        ...authenticated,
        connectedHost: 'example.invalid',
      }),
    ).toThrow('LOCAL_STANDARD_TEST_HOST_REQUIRED');
  });

  it.each([
    undefined,
    {},
    {
      authenticatedUsers: [],
      authenticatedUserRoles: authenticated.authInfo.authenticatedUserRoles,
    },
    {
      ...authenticated.authInfo,
      authenticatedUsers: [{ user: 'other', db: 'admin' }],
    },
    {
      ...authenticated.authInfo,
      authenticatedUsers: [{ user: 'root', db: 'eduforge_test' }],
    },
    {
      ...authenticated.authInfo,
      authenticatedUsers: [
        ...authenticated.authInfo.authenticatedUsers,
        { user: 'other', db: 'admin' },
      ],
    },
    { ...authenticated.authInfo, authenticatedUserRoles: [] },
    {
      ...authenticated.authInfo,
      authenticatedUserRoles: [{ role: 'readWrite', db: 'eduforge_test' }],
    },
    {
      ...authenticated.authInfo,
      authenticatedUserRoles: [{ role: 'root', db: 'eduforge_test' }],
    },
    {
      ...authenticated.authInfo,
      authenticatedUserRoles: [
        ...authenticated.authInfo.authenticatedUserRoles,
        { role: 'readWrite', db: 'eduforge_test' },
      ],
    },
  ])('requires actual unique root@admin user and role (%#)', (authInfo) => {
    expect(() =>
      assertLocalStandardTestAuthentication({ ...authenticated, authInfo }),
    ).toThrow('LOCAL_STANDARD_TEST_AUTHENTICATION_REQUIRED');
  });
});
