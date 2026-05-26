import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { Session } from '../schemas/session.schema';
import { SESSION_TTL_MS } from '../auth.constants';
import { WithId } from '../../../common/types/with-id.type';

type IdOnly = WithId;

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly maxSessionsPerUser = 5;

  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async onModuleInit() {
    // Ensure session indexes exist even when autoIndex is disabled.
    await this.sessionModel.ensureIndexes();
  }

  async createUserSession(userId: Types.ObjectId): Promise<string> {
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionModel.create({
      userId,
      token: sessionToken,
      expiresAt,
    });

    const staleSessions: IdOnly[] = await this.sessionModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(this.maxSessionsPerUser)
      .select('_id')
      .lean<IdOnly[]>()
      .exec();
    if (staleSessions.length > 0) {
      await this.sessionModel.deleteMany({
        _id: { $in: staleSessions.map((session) => session._id) },
      });
    }

    return sessionToken;
  }

  async deleteSession(token?: string): Promise<void> {
    if (!token) {
      return;
    }
    await this.sessionModel.deleteOne({ token }).exec();
  }

  async clearUserSessions(
    userId: Types.ObjectId | string,
    currentSessionToken?: string,
  ): Promise<void> {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    if (currentSessionToken) {
      await this.sessionModel
        .deleteMany({
          userId: normalizedUserId,
          token: { $ne: currentSessionToken },
        })
        .exec();
      return;
    }
    await this.sessionModel.deleteMany({ userId: normalizedUserId }).exec();
  }
}
