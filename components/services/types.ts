/**
 * The Services CRM wire shapes as the client reads them — the camelCase
 * views `lib/services/crm.ts` produces, mirrored once so the panels agree
 * with the routes about every field name.
 */

export type AccountView = {
  id: string;
  name: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  billingAddress: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactView = {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: string;
};

export type PropertyView = {
  id: string;
  accountId: string;
  label: string;
  address: string;
  propertyType: string | null;
  accessNotes: string | null;
  createdAt: string;
};

export type TimelineView = {
  id: string;
  accountId: string;
  kind: string;
  summary: string;
  detail: string | null;
  occurredAt: string;
  recordedAt: string;
  recordedBySystem: boolean;
};

export type AccountsPayload = {
  accounts: AccountView[];
  counts: {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    total: number;
  };
};

export type AccountDetailPayload = {
  account: AccountView;
  contacts: ContactView[];
  properties: PropertyView[];
  timeline: TimelineView[];
  timelineTruncated: boolean;
};
