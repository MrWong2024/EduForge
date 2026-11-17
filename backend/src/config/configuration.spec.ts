import configuration from './configuration';

describe('Backend port configuration (no I/O)', () => {
  const environmentKeys = [
    'BACKEND_PORT',
    'PORT',
    'NODE_ENV',
    'EDUFORGE_DATABASE_PURPOSE',
  ] as const;
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of environmentKeys) {
      previousEnv.set(key, process.env[key]);
    }
    delete process.env.BACKEND_PORT;
    delete process.env.PORT;
    process.env.NODE_ENV = 'test';
    process.env.EDUFORGE_DATABASE_PURPOSE = 'standard_test';
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it.each<[string, boolean]>([
    ['development', false],
    ['test', false],
    ['production', true],
  ])('provides a boolean Cookie Secure for %s', (environment, expected) => {
    process.env.NODE_ENV = environment;
    if (environment !== 'test') delete process.env.EDUFORGE_DATABASE_PURPOSE;
    expect(configuration().auth.cookieSecure).toBe(expected);
  });

  it.each<{
    label: string;
    backendPort?: string;
    legacyPort?: string;
    expectedPort: number;
  }>([
    { label: 'defaults to 5000 without BACKEND_PORT', expectedPort: 5000 },
    {
      label: 'uses an explicit BACKEND_PORT',
      backendPort: '6100',
      expectedPort: 6100,
    },
    {
      label: 'ignores a legacy PORT when BACKEND_PORT is absent',
      legacyPort: '6200',
      expectedPort: 5000,
    },
    {
      label: 'uses BACKEND_PORT when both keys are present',
      backendPort: '6100',
      legacyPort: '6200',
      expectedPort: 6100,
    },
    {
      label: 'ignores an invalid legacy PORT with explicit BACKEND_PORT',
      backendPort: '6100',
      legacyPort: 'not-a-port',
      expectedPort: 6100,
    },
    {
      label: 'ignores an invalid legacy PORT with the default port',
      legacyPort: 'not-a-port',
      expectedPort: 5000,
    },
  ])('$label', ({ backendPort, legacyPort, expectedPort }) => {
    if (backendPort !== undefined) {
      process.env.BACKEND_PORT = backendPort;
    }
    if (legacyPort !== undefined) {
      process.env.PORT = legacyPort;
    }

    expect(configuration().app.port).toBe(expectedPort);
  });
});
