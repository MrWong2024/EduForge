import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoginDto } from '../dto/login.dto';
import { Session } from '../schemas/session.schema';
import { User } from '../../users/schemas/user.schema';
import { comparePassword } from '../../users/password.utils';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';
import {
  AUTHENTICATED_ROLES,
  UserRole,
} from '../../users/schemas/user-roles.constants';
import { SessionService } from './session.service';

type UserWithMeta = User & WithId & WithTimestamps & { passwordHash?: string };
type SessionUserMeta = { id: string; roles: UserRole[] };

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionService: SessionService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = (await this.userModel
      .findOne({ email })
      .select('+passwordHash')
      .exec()) as UserWithMeta | null;
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isValid = await comparePassword(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Unauthorized');
    }

    const sessionToken = await this.sessionService.createUserSession(user._id);

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
    await this.sessionService.deleteSession(token);
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
