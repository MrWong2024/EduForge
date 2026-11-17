import { UserRole } from '../../modules/users/schemas/user-roles.constants';

export type AuthenticatedUser = {
  id: string;
  roles: UserRole[];
  sessionId: string;
  credentialVersion: number;
};
