import type {
  AcUser,
  ConnectProviderId,
  LearnerProfilePatch,
  PrimaryAdapterId,
  PrimaryAuthResult
} from "../core/types";

export interface UserStore {
  findById(id: string): Promise<AcUser | null>;
  findByEmail(email: string): Promise<AcUser | null>;
  findByPrimarySubject(adapter: PrimaryAdapterId, subject: string): Promise<AcUser | null>;
  findByConnectSubject(provider: ConnectProviderId, subject: string): Promise<AcUser | null>;
  createFromPrimary(result: PrimaryAuthResult, adapter: PrimaryAdapterId): Promise<AcUser>;
  update(userId: string, patch: Partial<AcUser>): Promise<AcUser>;
  updateLearnerProfile(userId: string, patch: LearnerProfilePatch): Promise<AcUser>;
  linkIdentity(userId: string, identity: AcUser["identities"][number]): Promise<AcUser>;
  unlinkIdentity(userId: string, provider: ConnectProviderId): Promise<AcUser>;
}
