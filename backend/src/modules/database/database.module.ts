import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

const expectedDatabaseNames: Record<string, string> = {
  development: 'eduforge_dev',
  test: 'eduforge_test',
  production: 'eduforge',
};

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): MongooseModuleOptions => {
        const mongoUri = configService.get<string>('mongo.uri');
        if (!mongoUri) {
          throw new Error('MONGO_URI is required.');
        }

        const env = configService.get<string>('app.env');

        if (!env) {
          throw new Error('app.env (NODE_ENV) is required.');
        }

        if (!['development', 'test', 'production'].includes(env)) {
          throw new Error(
            `Invalid NODE_ENV "${env}". Expected one of: development | test | production.`,
          );
        }

        const expectedDatabaseName = expectedDatabaseNames[env];

        return {
          uri: mongoUri,
          autoIndex: env === 'development',
          serverSelectionTimeoutMS: configService.get<number>(
            'mongo.serverSelectionTimeoutMS',
          ),
          connectionFactory: (connection: Connection): Connection => {
            const actualDatabaseName: string | undefined =
              connection.db?.databaseName;
            if (!actualDatabaseName) {
              throw new Error('MongoDB connection is missing databaseName.');
            }
            if (actualDatabaseName !== expectedDatabaseName) {
              throw new Error(
                `MongoDB databaseName mismatch: expected "${expectedDatabaseName}", got "${actualDatabaseName}".`,
              );
            }
            return connection;
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
