export type GitHubInstallationSnapshot = {
  account: {
    avatarUrl: string | null;
    id: number;
    login: string;
    type: "Organization" | "User";
  };
  appId: number;
  appSlug: string;
  events: string[];
  id: number;
  installedAt: string;
  permissions: Record<string, string>;
  repositories: GitHubRepositorySnapshot[];
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
  targetType: "Organization" | "User";
};

export type GitHubRepositorySnapshot = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  fullName: string;
  htmlUrl: string;
  githubUpdatedAt: string;
  id: number;
  name: string;
  nodeId: string | null;
  ownerLogin: string;
  permissions: Record<string, boolean>;
  private: boolean;
  pushedAt: string | null;
  visibility: "public" | "private" | "internal";
};

export type GitHubInstallationToken = {
  expiresAt: string;
  token: string;
};

export type GitHubConnectionContext = {
  appId: number;
  connectionId: string;
  installationId: number;
  internalInstallationId: string;
  organizationId: string;
  repository: {
    archived: boolean;
    defaultBranch: string;
    disabled: boolean;
    externalId: number;
    fullName: string;
    id: string;
    selected: boolean;
  } | null;
  role: "owner" | "admin" | "member" | "viewer";
  status: string;
  userId: string;
};
