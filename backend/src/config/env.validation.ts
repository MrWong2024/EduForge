import Joi from 'joi';

type EnvValidationInput = {
  AI_FEEDBACK_PROVIDER?: string;
  AI_FEEDBACK_REAL_ENABLED?: string;
  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  OPENROUTER_API_KEY?: string;
  BAILIAN_API_KEY?: string;
} & Record<string, unknown>;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  EDUFORGE_DATABASE_PURPOSE: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string()
      .valid('standard_test', 'browser_acceptance')
      .default('standard_test'),
    otherwise: Joi.forbidden(),
  }),
  BACKEND_PORT: Joi.number().port(),
  PORT: Joi.number().port(),
  FRONTEND_URL: Joi.string()
    .uri({ scheme: [/https?/] })
    .default('http://localhost:3000'),
  MAIL_PROVIDER: Joi.string().valid('log', 'smtp').default('log'),
  MAIL_FROM: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  MAIL_FROM_NAME: Joi.string().trim().min(1).default('EduForge'),
  SMTP_HOST: Joi.string().allow(''),
  SMTP_PORT: Joi.number().integer().min(1).max(65535).default(465),
  SMTP_SECURE: Joi.string().valid('true', 'false').default('true'),
  SMTP_USER: Joi.string().allow(''),
  SMTP_PASS: Joi.string().allow(''),
  MONGO_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\/\S+$/)
    .required()
    .messages({
      'string.pattern.base':
        'MONGO_URI must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://',
    }),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(5000),
  AI_FEEDBACK_PROVIDER: Joi.string()
    .valid('stub', 'openrouter', 'bailian')
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
  AI_FEEDBACK_MAX_ITEMS: Joi.number().integer().min(1).max(10).default(2),
  LEARNING_TASK_SUBMISSION_COOLDOWN_MS: Joi.number()
    .integer()
    .min(0)
    .default(300000),
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
  OPENROUTER_MODEL: Joi.string().default('openrouter/free'),
  OPENROUTER_TIMEOUT_MS: Joi.number().integer().min(1000).default(90000),
  OPENROUTER_MAX_RETRIES: Joi.number().integer().min(0).default(1),
  BAILIAN_API_KEY: Joi.string().allow(''),
  BAILIAN_BASE_URL: Joi.string()
    .uri({ scheme: [/https?/] })
    .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  BAILIAN_MODEL: Joi.string().default('qwen-plus'),
  BAILIAN_TIMEOUT_MS: Joi.number().integer().min(1000).default(90000),
  BAILIAN_MAX_RETRIES: Joi.number().integer().min(0).default(1),
})
  .unknown(true)
  .custom((value: EnvValidationInput, helpers) => {
    const provider =
      typeof value.AI_FEEDBACK_PROVIDER === 'string'
        ? value.AI_FEEDBACK_PROVIDER.toLowerCase()
        : 'stub';
    const realEnabled = value.AI_FEEDBACK_REAL_ENABLED === 'true';
    const hasOpenRouterApiKey =
      typeof value.OPENROUTER_API_KEY === 'string' &&
      value.OPENROUTER_API_KEY.length > 0;
    const hasBailianApiKey =
      typeof value.BAILIAN_API_KEY === 'string' &&
      value.BAILIAN_API_KEY.length > 0;
    if (provider === 'openrouter' && realEnabled && !hasOpenRouterApiKey) {
      return helpers.error('any.required', {
        missingKey: 'OPENROUTER_API_KEY',
      });
    }
    if (provider === 'bailian' && realEnabled && !hasBailianApiKey) {
      return helpers.error('any.required', { missingKey: 'BAILIAN_API_KEY' });
    }
    const mailProvider =
      typeof value.MAIL_PROVIDER === 'string'
        ? value.MAIL_PROVIDER.toLowerCase()
        : 'log';
    const hasSmtpHost =
      typeof value.SMTP_HOST === 'string' && value.SMTP_HOST.trim().length > 0;
    const hasSmtpUser =
      typeof value.SMTP_USER === 'string' && value.SMTP_USER.trim().length > 0;
    const hasSmtpPass =
      typeof value.SMTP_PASS === 'string' && value.SMTP_PASS.trim().length > 0;
    const hasMailFrom =
      typeof value.MAIL_FROM === 'string' && value.MAIL_FROM.trim().length > 0;
    if (mailProvider === 'smtp' && !hasSmtpHost) {
      return helpers.error('any.required', { missingKey: 'SMTP_HOST' });
    }
    if (mailProvider === 'smtp' && !hasSmtpUser) {
      return helpers.error('any.required', { missingKey: 'SMTP_USER' });
    }
    if (mailProvider === 'smtp' && !hasSmtpPass) {
      return helpers.error('any.required', { missingKey: 'SMTP_PASS' });
    }
    if (mailProvider === 'smtp' && !hasMailFrom) {
      return helpers.error('any.required', { missingKey: 'MAIL_FROM' });
    }
    return value;
  })
  .messages({ 'any.required': '{{#missingKey}} is required' })
  .options({ abortEarly: false });
