export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: Number.parseInt(
      process.env.BACKEND_PORT ?? process.env.PORT ?? '5000',
      10,
    ),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  },
  mongo: {
    uri: process.env.MONGO_URI,
    serverSelectionTimeoutMS: Number.parseInt(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS ?? '5000',
      10,
    ),
  },
});
