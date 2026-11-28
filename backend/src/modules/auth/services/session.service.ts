import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Session } from '../schemas/session.schema';
import { SESSION_TTL_MS } from '../auth.constants';

type SessionId = { _id: Types.ObjectId };

export const isSessionToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  token.length === 64 &&
  /^[a-f0-9]{64}$/.test(token);

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  private readonly maxSessionsPerUser = 5;

  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async createUserSession(
    userId: Types.ObjectId,
    credentialVersion: number,
  ): Promise<string> {
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionModel.create({
      userId,
      tokenHash: hashSessionToken(sessionToken),
      credentialVersion,
      expiresAt,
    });

    await this.pruneUserSessions(userId, credentialVersion);
    return sessionToken;
  }

  private async pruneUserSessions(
    userId: Types.ObjectId,
    credentialVersion: number,
  ): Promise<void> {
    const scope = {
      userId,
      credentialVersion,
      expiresAt: { $gt: new Date(Date.now()) },
    };
    // These timestamps stay fixed within a credential version, so overlapping
    // trims agree. A promotion wins ties with new sessions created in the same
    // millisecond even if its original ObjectId is older.
    const staleSessions = await this.sessionModel
      .aggregate<SessionId>([
        { $match: scope },
        {
          $project: {
            admittedAt: { $ifNull: ['$updatedAt', '$createdAt'] },
            wasPromoted: {
              $ne: [
                { $ifNull: ['$updatedAt', '$createdAt', null] },
                { $ifNull: ['$createdAt', null] },
              ],
            },
          },
        },
        { $sort: { admittedAt: -1, wasPromoted: -1, _id: -1 } },
        { $skip: this.maxSessionsPerUser },
        { $project: { _id: 1 } },
      ])
      .read('primary')
      .exec();
    if (staleSessions.length > 0) {
      await this.sessionModel
        .deleteMany({
          ...scope,
          _id: { $in: staleSessions.map((session) => session._id) },
        })
        .exec();
    }
  }

  async deleteSession(token: unknown): Promise<void> {
    if (!isSessionToken(token)) {
      return;
    }
    await this.sessionModel
      .deleteOne({ tokenHash: hashSessionToken(token) })
      .exec();
  }

  async clearUserSessionsBeforeVersion(
    userId: Types.ObjectId | string,
    newVersion: number,
  ): Promise<void> {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    await this.sessionModel
      .deleteMany({
        userId: normalizedUserId,
        credentialVersion: { $lt: newVersion },
      })
      .exec();
  }

  async promoteCurrentSession(
    userId: Types.ObjectId | string,
    sessionId: string,
    oldVersion: number,
    newVersion: number,
  ): Promise<boolean> {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const result = await this.sessionModel
      .updateOne(
        {
          _id: sessionId,
          userId: normalizedUserId,
          credentialVersion: oldVersion,
          expiresAt: { $gt: new Date() },
        },
        { $set: { credentialVersion: newVersion } },
        { upsert: false },
      )
      .exec();
    if (result.matchedCount !== 1) {
      return false;
    }
    await this.pruneUserSessions(normalizedUserId, newVersion);
    return true;
  }
}
