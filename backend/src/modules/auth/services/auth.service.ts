import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginDto } from '../dto/login.dto';
import { Session } from '../schemas/session.schema';
import { User, UserStatus } from '../../users/schemas/user.schema';
import {
  comparePassword,
  validateLoginPassword,
} from '../../users/password.utils';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import {
  AUTHENTICATED_ROLES,
  UserRole,
} from '../../users/schemas/user-roles.constants';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import {
  hashSessionToken,
  isSessionToken,
  SessionService,
} from './session.service';

type UserWithMeta = User & WithId & WithTimestamps & { passwordHash?: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionService: SessionService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const password = validateLoginPassword(dto.password);
    const user = (await this.userModel
      .findOne({ email, status: UserStatus.Active })
      .select('+passwordHash')
      .exec()) as UserWithMeta | null;
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Unauthorized');
    }

    const credentialVersion = user.credentialVersion;
    const sessionToken = await this.sessionService.createUserSession(
      user._id,
      credentialVersion,
    );
    try {
      const userStillValid = await this.userModel
        .exists({ _id: user._id, status: UserStatus.Active, credentialVersion })
        .exec();
      if (!userStillValid) {
        throw new UnauthorizedException('Unauthorized');
      }
    } catch (error) {
      await this.sessionService.deleteSession(sessionToken);
      throw error;
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

  async logout(token: unknown) {
    await this.sessionService.deleteSession(token);
  }

  async validateSession(token: unknown): Promise<AuthenticatedUser | null> {
    if (!isSessionToken(token)) {
      return null;
    }
    const session = await this.sessionModel
      .findOne({ tokenHash: hashSessionToken(token) })
      .exec();
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionModel.deleteOne({ _id: session._id }).exec();
      return null;
    }
    if (
      !Number.isInteger(session.credentialVersion) ||
      session.credentialVersion < 0
    ) {
      return null;
    }
    const user = await this.userModel
      .findOne({
        _id: session.userId,
        status: UserStatus.Active,
        credentialVersion: session.credentialVersion,
      })
      .select('_id roles credentialVersion')
      .exec();
    if (!user || user.credentialVersion !== session.credentialVersion) {
      return null;
    }
    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const normalizedRoles = userRoles.filter((role): role is UserRole =>
      AUTHENTICATED_ROLES.includes(role as UserRole),
    );
    return {
      id: user._id.toString(),
      roles: normalizedRoles,
      sessionId: session._id.toString(),
      credentialVersion: session.credentialVersion,
    };
  }
}
