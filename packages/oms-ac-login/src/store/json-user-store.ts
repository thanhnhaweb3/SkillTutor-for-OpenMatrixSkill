import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AcUser,
  ConnectProviderId,
  LinkedIdentity,
  LearnerProfilePatch,
  PrimaryAdapterId,
  PrimaryAuthResult
} from "../core/types";
import type { UserStore } from "./user-store";
import { AcError } from "../core/errors";
import { applyLearnerProfile } from "../core/profile";

interface UsersFile {
  users: AcUser[];
}

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) ?? email.slice(0, 2)).toUpperCase();
}

function createSeedUser(): AcUser {
  const now = new Date().toISOString();
  return {
    id: "user-demo",
    email: "jane@ctw.edu.vn",
    name: "Jane Doe",
    role: "learner",
    avatarInitials: "JD",
    primaryAdapter: "local",
    primarySubject: "local:jane@ctw.edu.vn",
    identities: [],
    createdAt: now,
    updatedAt: now,
    password: "password123"
  };
}

export class JsonUserStore implements UserStore {
  constructor(private readonly filePath = process.env.AC_USER_STORE_PATH ?? "./data/users.json") {}

  private get absolutePath() {
    return path.isAbsolute(this.filePath)
      ? this.filePath
      : path.join(process.cwd(), this.filePath);
  }

  private async read(): Promise<UsersFile> {
    try {
      const raw = await fs.readFile(this.absolutePath, "utf8");
      return JSON.parse(raw) as UsersFile;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") throw error;

      const initial = { users: [createSeedUser()] };
      await this.write(initial);
      return initial;
    }
  }

  private async write(data: UsersFile) {
    await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });
    await fs.writeFile(this.absolutePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async findById(id: string) {
    const data = await this.read();
    return data.users.find((user) => user.id === id) ?? null;
  }

  async findByEmail(email: string) {
    const data = await this.read();
    return data.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findByPrimarySubject(adapter: PrimaryAdapterId, subject: string) {
    const data = await this.read();
    return (
      data.users.find(
        (user) => user.primaryAdapter === adapter && user.primarySubject === subject
      ) ?? null
    );
  }

  async findByConnectSubject(provider: ConnectProviderId, subject: string) {
    const data = await this.read();
    return (
      data.users.find((user) =>
        user.identities.some(
          (identity) => identity.provider === provider && identity.subject === subject
        )
      ) ?? null
    );
  }

  async createFromPrimary(result: PrimaryAuthResult, adapter: PrimaryAdapterId) {
    const data = await this.read();
    const now = new Date().toISOString();
    const name = result.name ?? result.email.split("@")[0];
    const user: AcUser = {
      id: `user-${randomUUID().slice(0, 8)}`,
      email: result.email,
      name,
      role: "learner",
      avatarInitials: initials(name, result.email),
      primaryAdapter: adapter,
      primarySubject: result.subject,
      identities: [],
      createdAt: now,
      updatedAt: now
    };
    data.users.push(user);
    await this.write(data);
    return user;
  }

  async update(userId: string, patch: Partial<AcUser>) {
    const data = await this.read();
    const index = data.users.findIndex((user) => user.id === userId);
    if (index === -1) throw new AcError("user_not_found", 404);

    const updated: AcUser = {
      ...data.users[index],
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    data.users[index] = updated;
    await this.write(data);
    return updated;
  }

  async updateLearnerProfile(userId: string, patch: LearnerProfilePatch) {
    const user = await this.findById(userId);
    if (!user) throw new AcError("user_not_found", 404);
    return this.update(userId, applyLearnerProfile(user, patch));
  }

  async linkIdentity(userId: string, identity: LinkedIdentity) {
    const user = await this.findById(userId);
    if (!user) throw new AcError("user_not_found", 404);

    return this.update(userId, {
      identities: [
        ...user.identities.filter((item) => item.provider !== identity.provider),
        identity
      ]
    });
  }

  async unlinkIdentity(userId: string, provider: ConnectProviderId) {
    const user = await this.findById(userId);
    if (!user) throw new AcError("user_not_found", 404);

    const patch: Partial<AcUser> = {
      identities: user.identities.filter((item) => item.provider !== provider)
    };

    if (provider === "opencampus") {
      patch.ocid = undefined;
      patch.ethAddress = undefined;
    }

    if (provider === "github") {
      patch.githubLogin = undefined;
    }

    if (provider === "metamask") {
      patch.evmAddress = undefined;
      patch.metamaskWalletId = undefined;
    }

    return this.update(userId, patch);
  }
}
