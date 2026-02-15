import Joi from 'joi';

type EnvValidationInput = {
  AI_FEEDBACK_PROVIDER?: string;
  AI_FEEDBACK_REAL_ENABLED?: string;
  OPENROUTER_API_KEY?: string;
} & Record<string, unknown>;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  BACKEND_PORT: Joi.number().port(),
  PORT: Joi.number().port(),
  FRONTEND_URL: Joi.string()
    .uri({ scheme: [/https?/] })
    .default('http://localhost:3000'),
  MONGO_URI: Joi.string().uri().required(),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(5000),
  AI_FEEDBACK_PROVIDER: Joi.string()
    .valid('stub', 'openrouter')
    .default('stub'),
  AI_FEEDBACK_REAL_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false'),
  AI_FEEDBACK_MAX_CODE_CHARS: Joi.number()
    .integer()
    .min(500)
    .max(200000)
    .default(12000),
  AI_FEEDBACK_MAX_CONCURRENCY: Joi.number().integer().min(1).max(20).default(2),
  AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .max(600)
    .default(30),
  AI_FEEDBACK_AUTO_ON_SUBMIT: Joi.string()
    .valid('true', 'false')
    .default('true'),
  AI_FEEDBACK_AUTO_ON_FIRST_ATTEMPT_ONLY: Joi.string()
    .valid('true', 'false')
    .default('true'),
  AI_FEEDBACK_MAX_ITEMS: Joi.number().integer().min(1).max(100).default(20),
  AI_FEEDBACK_DEBUG_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false'),
  AUTHZ_ENFORCE_ROLES: Joi.string().valid('true', 'false').default('true'),
  OPENROUTER_API_KEY: Joi.string(),
  OPENROUTER_BASE_URL: Joi.string()
    .uri({ scheme: [/https?/] })
    .default('https://openrouter.ai/api/v1'),
  OPENROUTER_HTTP_REFERER: Joi.string()
    .uri({ scheme: [/https?/] })
    .default('https://eduforge.local'),
  OPENROUTER_X_TITLE: Joi.string().default('EduForge'),
  OPENROUTER_MODEL: Joi.string().default('openai/gpt-4o-mini'),
  OPENROUTER_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),
  OPENROUTER_MAX_RETRIES: Joi.number().integer().min(0).default(2),
})
  .unknown(true)
  .custom((value: EnvValidationInput, helpers) => {
    const provider =
      typeof value.AI_FEEDBACK_PROVIDER === 'string'
        ? value.AI_FEEDBACK_PROVIDER.toLowerCase()
        : 'stub';
    const realEnabled = value.AI_FEEDBACK_REAL_ENABLED === 'true';
    const hasApiKey =
      typeof value.OPENROUTER_API_KEY === 'string' &&
      value.OPENROUTER_API_KEY.length > 0;
    if (provider === 'openrouter' && realEnabled && !hasApiKey) {
      return helpers.error('any.required', { label: 'OPENROUTER_API_KEY' });
    }
    return value;
  })
  .options({ abortEarly: false });
