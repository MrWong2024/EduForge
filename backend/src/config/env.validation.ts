import Joi from 'joi';

type EnvValidationInput = {
  AI_FEEDBACK_PROVIDER?: string;
  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
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
  AI_FEEDBACK_PROVIDER: Joi.string().valid('stub', 'bailian').default('stub'),
  AI_FEEDBACK_WORKER_ENABLED: Joi.boolean().default(false),
  AI_FEEDBACK_WORKER_INTERVAL_MS: Joi.number().integer().min(1).default(10000),
  AI_FEEDBACK_WORKER_BATCH_SIZE: Joi.number().integer().min(1).default(5),
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
  BAILIAN_API_KEY: Joi.string().trim().allow(''),
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
    const hasBailianApiKey =
      typeof value.BAILIAN_API_KEY === 'string' &&
      value.BAILIAN_API_KEY.trim().length > 0;
    if (provider === 'bailian' && !hasBailianApiKey) {
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
