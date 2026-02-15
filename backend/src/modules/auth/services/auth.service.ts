import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { LoginDto } from '../dto/login.dto';
import { Session } from '../schemas/session.schema';
import { User } from '../../users/schemas/user.schema';
import { SESSION_TTL_MS } from '../auth.constants';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import {
  AUTHENTICATED_ROLES,
  UserRole,
} from '../../users/schemas/user-roles.constants';

type UserWithMeta = User & WithId & WithTimestamps & { passwordHash?: string };
type IdOnly = WithId;
type SessionUserMeta = { id: string; roles: UserRole[] };

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async onModuleInit() {
    // Ensure session indexes exist even when autoIndex is disabled.
    await this.sessionModel.ensureIndexes();
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = (await this.userModel
      .findOne({ email })
      .select('+passwordHash')
      .exec()) as UserWithMeta | null;
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Unauthorized');
    }

    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionModel.create({
      userId: user._id,
      token: sessionToken,
      expiresAt,
    });
    // Strategy B: allow multiple sessions, keep only the latest N per user.
    const maxSessionsPerUser = 5;
    const staleSessions: IdOnly[] = await this.sessionModel
      .find({ userId: user._id })
      .sort({ createdAt: -1 })
      .skip(maxSessionsPerUser)
      .select('_id')
      .lean()
      .exec();
    if (staleSessions.length > 0) {
      await this.sessionModel.deleteMany({
        _id: { $in: staleSessions.map((session) => session._id) },
      });
    }

    return {
      sessionToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        roles: user.roles,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  async logout(token?: string) {
    if (!token) {
      return;
    }
    await this.sessionModel.deleteOne({ token }).exec();
  }

  async validateSession(token?: string): Promise<SessionUserMeta | null> {
    if (!token) {
      return null;
    }
    const session = await this.sessionModel.findOne({ token }).exec();
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionModel.deleteOne({ _id: session._id }).exec();
      return null;
    }
    const user = await this.userModel
      .findById(session.userId)
      .select('_id roles')
      .exec();
    if (!user) {
      return null;
    }
    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const normalizedRoles = userRoles.filter((role): role is UserRole =>
      AUTHENTICATED_ROLES.includes(role as UserRole),
    );
    return {
      id: user._id.toString(),
      roles: normalizedRoles,
    };
  }
}
