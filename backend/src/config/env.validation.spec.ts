import { envValidationSchema } from './env.validation';

const baseEnv = {
  NODE_ENV: 'test',
  MAIL_FROM: 'unit@example.invalid',
  MONGO_URI: 'mongodb://127.0.0.1:1/ai_feedback_unit',
};

function validate(overrides: Record<string, unknown> = {}) {
  const result = envValidationSchema.validate({ ...baseEnv, ...overrides });
  return {
    error: result.error,
    value: result.value as Record<string, unknown>,
  };
}

describe('AI Feedback env validation (no external I/O)', () => {
  it('defaults to stub without real API keys and supplies all worker defaults', () => {
    const result = validate();

    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      AI_FEEDBACK_PROVIDER: 'stub',
      AI_FEEDBACK_WORKER_ENABLED: false,
      AI_FEEDBACK_WORKER_INTERVAL_MS: 10000,
      AI_FEEDBACK_WORKER_BATCH_SIZE: 5,
    });
  });

  it('allows stub with blank keys even when the worker is enabled', () => {
    expect(
      validate({
        AI_FEEDBACK_PROVIDER: 'stub',
        BAILIAN_API_KEY: '',
        AI_FEEDBACK_WORKER_ENABLED: 'true',
      }).error,
    ).toBeUndefined();
  });

  it('accepts Bailian with its own key without enabling the worker', () => {
    const result = validate({
      AI_FEEDBACK_PROVIDER: 'bailian',
      BAILIAN_API_KEY: 'synthetic-unit-key',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.AI_FEEDBACK_WORKER_ENABLED).toBe(false);
  });

  it.each([undefined, '', ' \t '])(
    'rejects a missing or blank Bailian key (%p)',
    (key) => {
      const result = validate({
        AI_FEEDBACK_PROVIDER: 'bailian',
        BAILIAN_API_KEY: key,
        AI_FEEDBACK_WORKER_ENABLED: 'false',
      });
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('BAILIAN_API_KEY');
    },
  );

  it.each(['unsupported-provider', ''])(
    'rejects an invalid provider (%p)',
    (provider) => {
      const result = validate({ AI_FEEDBACK_PROVIDER: provider });
      expect(result.error).toBeDefined();
      expect(
        result.error?.details.some(
          (detail) => detail.path[0] === 'AI_FEEDBACK_PROVIDER',
        ),
      ).toBe(true);
    },
  );

  it.each(['true', 'false'])(
    'converts worker enabled=%s and numeric values',
    (enabled) => {
      const result = validate({
        AI_FEEDBACK_WORKER_ENABLED: enabled,
        AI_FEEDBACK_WORKER_INTERVAL_MS: '1',
        AI_FEEDBACK_WORKER_BATCH_SIZE: '3',
      });

      expect(result.error).toBeUndefined();
      expect(result.value).toMatchObject({
        AI_FEEDBACK_WORKER_ENABLED: enabled === 'true',
        AI_FEEDBACK_WORKER_INTERVAL_MS: 1,
        AI_FEEDBACK_WORKER_BATCH_SIZE: 3,
      });
    },
  );

  it.each(['yes', '1', '', 1])(
    'rejects invalid worker boolean %p',
    (enabled) => {
      expect(
        validate({ AI_FEEDBACK_WORKER_ENABLED: enabled }).error,
      ).toBeDefined();
    },
  );

  describe.each([
    'AI_FEEDBACK_WORKER_INTERVAL_MS',
    'AI_FEEDBACK_WORKER_BATCH_SIZE',
  ])('%s', (key) => {
    it.each([0, -1, 1.5, 'invalid', '', Infinity])(
      'rejects non-positive or non-integer values (%p)',
      (value) => {
        const result = validate({ [key]: value });

        expect(result.error).toBeDefined();
        expect(
          result.error?.details.some((detail) => detail.path[0] === key),
        ).toBe(true);
      },
    );
  });
});
