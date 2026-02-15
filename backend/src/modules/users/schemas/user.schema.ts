import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { USER_ROLE_USER } from './user-roles.constants';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
}

@Schema({ timestamps: true })
export class User {
  @Prop({
    required: true,
    unique: true,
    index: true,
    lowercase: true,
    trim: true,
  })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: [String], default: [USER_ROLE_USER] })
  roles!: string[];

  @Prop({ type: String, default: UserStatus.Active })
  status!: UserStatus;
}

export const UserSchema = SchemaFactory.createForClass(User);
