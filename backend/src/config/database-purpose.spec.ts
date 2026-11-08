import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mongo } from 'mongoose';
import {
  assertBrowserAcceptancePreImportEnvironment,
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
  getExpectedDatabaseName,
  readDeclaredDatabaseName,
  resolveTestDatabasePurpose,
} from './database-purpose';
import {
  createBrowserAcceptanceEnvironment,
  isLocalRootBrowserUri,
} from './browser-acceptance-environment';
import { envValidationSchema } from './env.validation';

const uri = (database: string, user = 'synthetic-app') =>
  `mongodb://${user}:synthetic-password@127.0.0.1:1/${database}`;
const localRootUri = (host = '127.0.0.1:27017') =>
  `mongodb://root:synthetic-password@${host}/eduforge_browser_test?authSource=admin`;
const browserFile = {
  EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
  MONGO_URI: localRootUri('127.0.0.1:1'),
};

describe('database purpose gates (no database connection)', () => {
  it('defaults an omitted test purpose to standard_test', () => {
    expect(resolveTestDatabasePurpose('test', undefined)).toBe('standard_test');
  });

  it.each<[string, string | undefined, string]>([
    ['development', undefined, 'eduforge_dev'],
    ['test', undefined, 'eduforge_test'],
    ['test', 'standard_test', 'eduforge_test'],
    ['test', 'browser_acceptance', 'eduforge_browser_test'],
    ['production', undefined, 'eduforge'],
  ])('maps %s / %s to %s', (nodeEnv, purpose, databaseName) => {
    const environment = { nodeEnv, purpose };
    expect(getExpectedDatabaseName(environment)).toBe(databaseName);
    expect(() =>
      assertDeclaredDatabaseMatchesPurpose({
        ...environment,
        mongoUri: uri(databaseName),
      }),
    ).not.toThrow();
    expect(() =>
      assertConnectedDatabaseMatchesPurpose({
        ...environment,
        databaseName,
      }),
    ).not.toThrow();
  });

  it.each([
    ['browser_acceptance', 'eduforge_test'],
    ['standard_test', 'eduforge_browser_test'],
    ['browser_acceptance', 'eduforge_dev'],
    ['browser_acceptance', 'eduforge'],
  ])('rejects %s declaring or connecting to %s', (purpose, databaseName) => {
    expect(() =>
      assertDeclaredDatabaseMatchesPurpose({
        nodeEnv: 'test',
        purpose,
        mongoUri: uri(databaseName),
      }),
    ).toThrow('DATABASE_DECLARED_NAME_MISMATCH');
    expect(() =>
      assertConnectedDatabaseMatchesPurpose({
        nodeEnv: 'test',
        purpose,
        databaseName,
      }),
    ).toThrow('DATABASE_CONNECTED_NAME_MISMATCH');
  });

  it.each(['development', 'production'])(
    'rejects Browser purpose in %s',
    (nodeEnv) => {
      expect(() =>
        resolveTestDatabasePurpose(nodeEnv, 'browser_acceptance'),
      ).toThrow('DATABASE_PURPOSE_REQUIRES_TEST');
      expect(() =>
        assertBrowserAcceptancePreImportEnvironment({
          nodeEnv,
          purpose: 'browser_acceptance',
          mongoUri: uri('eduforge_browser_test'),
        }),
      ).toThrow('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
    },
  );

  it.each(['', 'unknown'])('rejects invalid test purpose %s', (purpose) => {
    expect(() => resolveTestDatabasePurpose('test', purpose)).toThrow(
      'DATABASE_PURPOSE_INVALID',
    );
  });

  it('does not introduce a Browser NODE_ENV or allow the standard purpose through the pre-import gate', () => {
    expect(() =>
      resolveTestDatabasePurpose('browser_acceptance', undefined),
    ).toThrow('DATABASE_NODE_ENV_INVALID');
    expect(() =>
      assertBrowserAcceptancePreImportEnvironment({
        nodeEnv: 'test',
        purpose: 'standard_test',
        mongoUri: uri('eduforge_browser_test'),
      }),
    ).toThrow('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
  });

  it.each([
    undefined,
    '',
    'not-a-uri',
    'mongodb://localhost',
    'mongodb://localhost/',
    'mongodb://localhost/?authSource=eduforge_browser_test',
    'mongodb://localhost/eduforge_browser_test/extra',
    'mongodb://localhost/%ZZ',
    'mongodb://localhost/eduforge_browser_test#fragment',
    'mongodb://localhost/eduforge_browser_test trailing',
  ])(
    'fails closed for a missing or unparseable database path (%#)',
    (mongoUri) => {
      expect(readDeclaredDatabaseName(mongoUri)).toBeUndefined();
      expect(() =>
        assertDeclaredDatabaseMatchesPurpose({
          nodeEnv: 'test',
          purpose: 'browser_acceptance',
          mongoUri,
        }),
      ).toThrow('DATABASE_DECLARED_NAME_MISMATCH');
    },
  );

  it('accepts explicit database names in seed lists and SRV URIs', () => {
    expect(
      readDeclaredDatabaseName(
        'mongodb://host-a:27017,host-b:27017/eduforge_test?replicaSet=example',
      ),
    ).toBe('eduforge_test');
    expect(
      readDeclaredDatabaseName(
        'mongodb+srv://example.invalid/eduforge%5Fbrowser_test',
      ),
    ).toBe('eduforge_browser_test');
  });

  it('rejects a missing actual database name without exposing configuration values', () => {
    expect(() =>
      assertConnectedDatabaseMatchesPurpose({
        nodeEnv: 'test',
        purpose: 'browser_acceptance',
        databaseName: undefined,
      }),
    ).toThrow('DATABASE_CONNECTED_NAME_MISMATCH');
    try {
      assertDeclaredDatabaseMatchesPurpose({
        nodeEnv: 'test',
        purpose: 'browser_acceptance',
        mongoUri: uri('wrong'),
      });
      throw new Error('The gate should have failed');
    } catch (error) {
      expect(String(error)).not.toContain('synthetic-password');
      expect(String(error)).not.toContain('mongodb://');
      expect(String(error)).toContain('DATABASE_DECLARED_NAME_MISMATCH');
    }
  });
});

describe('local root Browser URI gate (no database connection)', () => {
  it.each(['127.0.0.1:27017', 'localhost:27017', '[::1]:27017'])(
    'accepts one loopback host %s from the dedicated file',
    (host) => {
      const mongoUri = localRootUri(host);
      expect(isLocalRootBrowserUri(mongoUri)).toBe(true);
      const result = createBrowserAcceptanceEnvironment(
        {
          ...browserFile,
          MONGO_URI: mongoUri,
        },
        { MONGO_ADMIN_URI: 'stale', AI_FEEDBACK_WORKER_ENABLED: 'true' },
      );
      expect(result.MONGO_URI).toBe(mongoUri);
      expect(result.MONGO_ADMIN_URI).toBeUndefined();
      expect(result.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI).toBeUndefined();
      expect(result.AI_FEEDBACK_WORKER_ENABLED).toBe('false');
    },
  );

  it.each([
    ['omitted', ''],
    ['false', '&directConnection=false'],
    ['true', '&directConnection=true'],
  ])(
    'accepts directConnection %s for the local standalone URI',
    (_name, option) => {
      const mongoUri = localRootUri() + option;
      expect(isLocalRootBrowserUri(mongoUri)).toBe(true);
      expect(
        createBrowserAcceptanceEnvironment(
          {
            ...browserFile,
            MONGO_URI: mongoUri,
          },
          {},
        ).MONGO_URI,
      ).toBe(mongoUri);
    },
  );

  it('decodes credentials and authSource without connecting', () => {
    const connect = jest
      .spyOn(mongo.MongoClient.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error('A pure URI gate must not connect');
      });
    try {
      expect(
        isLocalRootBrowserUri(
          'mongodb://%72oot:synthetic%40%3A%2F%3F%23%25@localhost/eduforge_browser_test?authSource=%61dmin&authMechanism=SCRAM-SHA-256',
        ),
      ).toBe(true);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });

  it.each<[string, string | undefined]>([
    ['missing URI', undefined],
    ['remote host', localRootUri('example.invalid:27017')],
    ['lookalike localhost', localRootUri('localhost.example.invalid:27017')],
    ['loopback lookalike', localRootUri('127.0.0.1.example.invalid:27017')],
    ['SRV', localRootUri('localhost').replace('mongodb://', 'mongodb+srv://')],
    ['multiple hosts', localRootUri('127.0.0.1:27017,localhost:27017')],
    ['wrong username', localRootUri().replace('root:', 'synthetic-app:')],
    [
      'wrong auth source',
      localRootUri().replace('authSource=admin', 'authSource=other'),
    ],
    ['missing auth source', localRootUri().replace('?authSource=admin', '')],
    ['missing password', localRootUri().replace(':synthetic-password@', '@')],
    ['proxy', localRootUri() + '&proxyHost=example.invalid'],
    ['explicit replica set', localRootUri() + '&replicaSet=synthetic'],
    ['load balancing', localRootUri() + '&loadBalanced=true'],
    ['load balancing option', localRootUri() + '&loadBalanced=false'],
    ['SRV option', localRootUri() + '&srvServiceName=synthetic'],
    ['external auth mechanism', localRootUri() + '&authMechanism=GSSAPI'],
    [
      'ambiguous direct option',
      localRootUri() + '&directConnection=true&DIRECTCONNECTION=false',
    ],
    [
      'wrong database',
      localRootUri().replace('/eduforge_browser_test?', '/eduforge_test?'),
    ],
    ['overridden database', localRootUri() + '&dbName=eduforge_test'],
    [
      'invalid credential encoding',
      localRootUri().replace('synthetic-password', '%ZZ'),
    ],
  ])('rejects %s without exposing parser errors', (_name, mongoUri) => {
    expect(() => isLocalRootBrowserUri(mongoUri)).not.toThrow();
    expect(isLocalRootBrowserUri(mongoUri)).toBe(false);
    expect(() =>
      createBrowserAcceptanceEnvironment(
        { ...browserFile, MONGO_URI: mongoUri },
        {},
      ),
    ).toThrow();
  });

  it('keeps purpose and database gates before the local root URI gate', () => {
    expect(() =>
      createBrowserAcceptanceEnvironment(
        { ...browserFile, EDUFORGE_DATABASE_PURPOSE: 'standard_test' },
        {},
      ),
    ).toThrow('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
    expect(() =>
      createBrowserAcceptanceEnvironment(
        {
          ...browserFile,
          MONGO_URI: localRootUri().replace(
            '/eduforge_browser_test?',
            '/eduforge_test?',
          ),
        },
        {},
      ),
    ).toThrow('DATABASE_DECLARED_NAME_MISMATCH');
  });

  it('returns only the fixed gate error for a rejected root URI', () => {
    const mongoUri = localRootUri('example.invalid:27017');
    try {
      createBrowserAcceptanceEnvironment(
        {
          ...browserFile,
          MONGO_URI: mongoUri,
        },
        {},
      );
      throw new Error('The gate should have failed');
    } catch (error) {
      expect(String(error)).toBe(
        'DatabaseGateError: BROWSER_DATABASE_LOCAL_ROOT_URI_REQUIRED',
      );
      expect(String(error)).not.toContain('synthetic-password');
      expect(String(error)).not.toContain('mongodb://');
    }
  });
});

describe('Browser environment and launcher isolation', () => {
  it('takes the application URI only from the Browser file and removes stale connection/admin/provider variables', () => {
    const inherited = {
      NODE_ENV: 'production',
      EDUFORGE_DATABASE_PURPOSE: 'standard_test',
      MONGO_URI: uri('eduforge'),
      MONGO_ADMIN_URI: uri('eduforge', 'synthetic-admin'),
      BROWSER_ACCEPTANCE_APP_MONGO_URI: uri('eduforge_test'),
      BROWSER_ACCEPTANCE_ADMIN_MONGO_URI: uri('eduforge_test'),
      MAIL_PROVIDER: 'smtp',
      MAIL_FROM: 'inherited@example.invalid',
      MAIL_FROM_NAME: 'Inherited sender',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'synthetic-user',
      SMTP_PASS: 'synthetic-smtp',
      BAILIAN_API_KEY: 'synthetic-key',
      AI_FEEDBACK_WORKER_ENABLED: 'true',
      AI_FEEDBACK_PROVIDER: 'bailian',
      BACKEND_PORT: '5003',
      PATH: 'synthetic-path',
    };
    const result = createBrowserAcceptanceEnvironment(
      {
        ...browserFile,
        MONGO_ADMIN_URI: uri('eduforge'),
        BROWSER_ACCEPTANCE_APP_MONGO_URI: uri('eduforge_test'),
        BROWSER_ACCEPTANCE_ADMIN_MONGO_URI: uri('eduforge_test'),
      },
      inherited,
    );
    expect(result.NODE_ENV).toBe('test');
    expect(result.EDUFORGE_DATABASE_PURPOSE).toBe('browser_acceptance');
    expect(result.MONGO_URI).toBe(browserFile.MONGO_URI);
    for (const key of [
      'MONGO_ADMIN_URI',
      'BROWSER_ACCEPTANCE_APP_MONGO_URI',
      'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
      'MAIL_FROM',
      'MAIL_FROM_NAME',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USER',
      'SMTP_PASS',
      'BAILIAN_API_KEY',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.MAIL_PROVIDER).toBe('log');
    expect(result.AI_FEEDBACK_WORKER_ENABLED).toBe('false');
    expect(result.AI_FEEDBACK_PROVIDER).toBe('stub');
    expect(result.BACKEND_PORT).toBe('5003');
    expect(result.PATH).toBe('synthetic-path');
    expect(inherited.NODE_ENV).toBe('production');
    expect(envValidationSchema.validate(result).error).toBeUndefined();
  });

  it('requires the dedicated file MONGO_URI without inherited or legacy fallback', () => {
    for (const value of [undefined, '', uri('eduforge_test')]) {
      expect(() =>
        createBrowserAcceptanceEnvironment(
          {
            ...browserFile,
            MONGO_URI: value,
            MONGO_ADMIN_URI: localRootUri(),
            BROWSER_ACCEPTANCE_APP_MONGO_URI: localRootUri(),
            BROWSER_ACCEPTANCE_ADMIN_MONGO_URI: localRootUri(),
          },
          { MONGO_URI: localRootUri() },
        ),
      ).toThrow('DATABASE_DECLARED_NAME_MISMATCH');
    }
  });

  it('requires the file purpose without inherited fallback', () => {
    expect(() =>
      createBrowserAcceptanceEnvironment(
        { ...browserFile, EDUFORGE_DATABASE_PURPOSE: undefined },
        { EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance' },
      ),
    ).toThrow('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
  });

  it('validates purpose without supplying a fallback Mongo URI', () => {
    const base = {
      NODE_ENV: 'test',
      MAIL_FROM: 'synthetic@example.invalid',
      MONGO_URI: uri('eduforge_test'),
    };
    const validated = envValidationSchema.validate(base).value as {
      EDUFORGE_DATABASE_PURPOSE: string;
    };
    expect(validated.EDUFORGE_DATABASE_PURPOSE).toBe('standard_test');
    expect(
      envValidationSchema.validate({
        NODE_ENV: 'test',
        MAIL_FROM: base.MAIL_FROM,
        EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
      }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({
        ...base,
        NODE_ENV: 'production',
        EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
      }).error,
    ).toBeDefined();
  });

  it('loads one fixed file, gates before importing AppModule, and shares the normal app setup', () => {
    const launcher = readFileSync(
      resolve(__dirname, '../../scripts/start-browser-test-backend.ts'),
      'utf8',
    );
    const appModule = readFileSync(
      resolve(__dirname, '../app.module.ts'),
      'utf8',
    );
    const main = readFileSync(resolve(__dirname, '../main.ts'), 'utf8');
    expect(launcher).toContain(
      "readFileSync(resolve(__dirname, '..', '.env.browser-acceptance'))",
    );
    expect(launcher).not.toContain('.env.test');
    expect(
      launcher.indexOf('createBrowserAcceptanceEnvironment(file, process.env)'),
    ).toBeLessThan(launcher.indexOf("loadApplication('../src/app.module')"));
    expect(
      launcher.indexOf('assertBrowserAcceptancePreImportEnvironment({'),
    ).toBeLessThan(launcher.indexOf("loadApplication('../src/app.module')"));
    expect(appModule).toContain('ignoreEnvFile: browserAcceptance');
    expect(appModule).toContain(
      "process.env.EDUFORGE_DATABASE_PURPOSE === 'browser_acceptance'",
    );
    expect(appModule).toContain(
      "envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env']",
    );
    expect(main).toContain('configureApp(app)');
    expect(launcher).toContain('configureApp(app)');
    expect(
      launcher.indexOf('assertConnectedDatabaseMatchesPurpose({'),
    ).toBeLessThan(launcher.indexOf('await app.listen('));
  });
});
