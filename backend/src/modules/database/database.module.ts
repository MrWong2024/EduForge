import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  assertConnectedDatabaseMatchesPurpose,
  assertDeclaredDatabaseMatchesPurpose,
} from '../../config/database-purpose';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): MongooseModuleOptions => {
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
          autoIndex: env === 'development' || env === 'test',
          ...(purpose === 'browser_acceptance' ? { retryAttempts: 1 } : {}),
          serverSelectionTimeoutMS: configService.get<number>(
            'mongo.serverSelectionTimeoutMS',
          ),
          connectionFactory: async (
            connection: Connection,
          ): Promise<Connection> => {
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
      },
    }),
  ],
})
export class DatabaseModule {}
