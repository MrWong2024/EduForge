import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertBrowserAcceptancePreImportEnvironment,
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
  getExpectedDatabaseName,
  readDeclaredDatabaseName,
  resolveTestDatabasePurpose,
} from './database-purpose';
import { createBrowserAcceptanceEnvironment } from './browser-acceptance-environment';
import { envValidationSchema } from './env.validation';

const uri = (database: string, user = 'synthetic-app') =>
  `mongodb://${user}:synthetic-password@127.0.0.1:1/${database}`;
const browserFile = {
  EDUFORGE_DATABASE_PURPOSE: 'browser_acceptance',
  BROWSER_ACCEPTANCE_APP_MONGO_URI: uri('eduforge_browser_test'),
  BROWSER_ACCEPTANCE_ADMIN_MONGO_URI: uri(
    'eduforge_browser_test',
    'synthetic-admin',
  ),
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
      SMTP_PASS: 'synthetic-smtp',
      BAILIAN_API_KEY: 'synthetic-key',
      AI_FEEDBACK_WORKER_ENABLED: 'true',
      AI_FEEDBACK_REAL_ENABLED: 'true',
      BACKEND_PORT: '5003',
      PATH: 'synthetic-path',
    };
    const result = createBrowserAcceptanceEnvironment(browserFile, inherited);
    expect(result.NODE_ENV).toBe('test');
    expect(result.EDUFORGE_DATABASE_PURPOSE).toBe('browser_acceptance');
    expect(result.MONGO_URI).toBe(browserFile.BROWSER_ACCEPTANCE_APP_MONGO_URI);
    expect(result.MONGO_URI).not.toBe(
      browserFile.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI,
    );
    for (const key of [
      'MONGO_ADMIN_URI',
      'BROWSER_ACCEPTANCE_APP_MONGO_URI',
      'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
      'SMTP_PASS',
      'BAILIAN_API_KEY',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.MAIL_PROVIDER).toBe('log');
    expect(result.AI_FEEDBACK_WORKER_ENABLED).toBe('false');
    expect(result.AI_FEEDBACK_REAL_ENABLED).toBe('false');
    expect(result.BACKEND_PORT).toBe('5003');
    expect(result.PATH).toBe('synthetic-path');
    expect(inherited.NODE_ENV).toBe('production');
    expect(envValidationSchema.validate(result).error).toBeUndefined();
  });

  it.each([
    'BROWSER_ACCEPTANCE_APP_MONGO_URI',
    'BROWSER_ACCEPTANCE_ADMIN_MONGO_URI',
  ])('requires %s to declare the Browser database', (key) => {
    for (const value of [undefined, uri('eduforge_test')]) {
      expect(() =>
        createBrowserAcceptanceEnvironment(
          { ...browserFile, [key]: value },
          {},
        ),
      ).toThrow('DATABASE_DECLARED_NAME_MISMATCH');
    }
  });

  it('requires the file purpose and distinct app/admin URIs', () => {
    expect(() =>
      createBrowserAcceptanceEnvironment(
        { ...browserFile, EDUFORGE_DATABASE_PURPOSE: undefined },
        {},
      ),
    ).toThrow('BROWSER_DATABASE_ENVIRONMENT_REQUIRED');
    expect(() =>
      createBrowserAcceptanceEnvironment(
        {
          ...browserFile,
          BROWSER_ACCEPTANCE_APP_MONGO_URI:
            browserFile.BROWSER_ACCEPTANCE_ADMIN_MONGO_URI,
        },
        {},
      ),
    ).toThrow('BROWSER_APPLICATION_URI_MUST_DIFFER_FROM_ADMIN');
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
