import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
} from '../../config/database-purpose';
import { CLASSROOM_TASK_TRANSACTION_CONNECTION } from '../../lib/classroom-task-transaction';

function databaseOptions(
  configService: ConfigService,
  classroomTransactions: boolean,
): MongooseModuleOptions {
  const mongoUri = configService.get<string>('mongo.uri');
  const env = configService.get<string>('app.env');
  const purpose = configService.get<string>('mongo.purpose');
  const databaseEnvironment = { nodeEnv: env, purpose };
  assertDeclaredDatabaseMatchesPurpose({
    ...databaseEnvironment,
    mongoUri,
  });

  return {
    uri: mongoUri,
    autoIndex:
      !classroomTransactions && (env === 'development' || env === 'test'),
    ...(purpose === 'browser_acceptance' ? { retryAttempts: 1 } : {}),
    serverSelectionTimeoutMS: configService.get<number>(
      'mongo.serverSelectionTimeoutMS',
    ),
    ...(classroomTransactions
      ? {
          autoCreate: false,
          bufferCommands: false,
          retryAttempts: 1,
          // Transport bounds for the session API, independent of its shared application deadline.
          connectTimeoutMS: 10000,
          waitQueueTimeoutMS: 10000,
          socketTimeoutMS: 10000,
          maxAdaptiveRetries: 0,
        }
      : {}),
    connectionFactory: async (connection: Connection): Promise<Connection> => {
      try {
        assertConnectedDatabaseMatchesPurpose({
          ...databaseEnvironment,
          databaseName: connection.db?.databaseName,
        });
      } catch (error) {
        await connection.close();
        throw error;
      }
      return connection;
    },
  };
}

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        databaseOptions(configService, false),
    }),
    MongooseModule.forRootAsync({
      connectionName: CLASSROOM_TASK_TRANSACTION_CONNECTION,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        databaseOptions(configService, true),
    }),
  ],
})
export class DatabaseModule {}
