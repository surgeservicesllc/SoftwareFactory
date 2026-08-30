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

export type OpportunityView = {
  id: string;
  accountId: string;
  name: string;
  stage: string;
  valueCents: number | null;
  expectedCloseDate: string | null;
  notes: string | null;
  lostReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineReport = {
  byStage: Record<string, { count: number; valueCents: number }>;
  openCount: number;
  openValueCents: number;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  winRatePercent: number | null;
};

export type OpportunitiesPayload = {
  opportunities: OpportunityView[];
  report: PipelineReport;
};

export type SearchPayload = {
  query: string;
  accounts: AccountView[];
  contacts: ContactView[];
  properties: PropertyView[];
  opportunities: OpportunityView[];
};

export type TechnicianView = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServicePlanView = {
  id: string;
  accountId: string;
  propertyId: string;
  serviceType: string;
  recurrence: string;
  nextDue: string;
  technicianId: string | null;
  valueCents: number | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkOrderView = {
  id: string;
  accountId: string;
  propertyId: string;
  technicianId: string | null;
  planId: string | null;
  status: string;
  serviceType: string;
  scheduledStart: string;
  scheduledEnd: string;
  instructions: string | null;
  completionNotes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceView = {
  id: string;
  accountId: string;
  propertyId: string;
  label: string;
  deviceType: string;
  barcode: string;
  status: string;
  locationNote: string | null;
  activityThreshold: number | null;
  installedAt: string;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceEventView = {
  id: string;
  deviceId: string;
  event: string;
  condition: string | null;
  activityCount: number | null;
  pestObserved: string | null;
  locationNote: string | null;
  note: string | null;
  workOrderId: string | null;
  recordedAt: string;
  recordedBySystem: boolean;
};

export type SightingView = {
  id: string;
  accountId: string;
  propertyId: string;
  pest: string;
  severity: string;
  locationNote: string | null;
  note: string | null;
  sightedAt: string;
  correctiveAction: string | null;
  correctedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductView = {
  id: string;
  name: string;
  epaRegistrationNumber: string | null;
  activeIngredient: string | null;
  signalWord: string | null;
  sdsUrl: string | null;
  labelUrl: string | null;
  restrictedUse: boolean;
  defaultUnit: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LotView = {
  id: string;
  productId: string;
  lotNumber: string;
  unit: string;
  quantityReceived: number;
  quantityRemaining: number;
  receivedOn: string;
  expiresOn: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationView = {
  id: string;
  accountId: string;
  propertyId: string;
  workOrderId: string | null;
  productId: string;
  lotId: string | null;
  deviceId: string | null;
  technicianId: string;
  applicatorLicense: string | null;
  method: string;
  targetPest: string | null;
  quantity: number;
  unit: string;
  applicationRate: string | null;
  treatedArea: string | null;
  locationNote: string | null;
  note: string | null;
  appliedAt: string;
  recordedAt: string;
  supersedesId: string | null;
};

export type ComplianceRuleView = {
  id: string;
  jurisdiction: string;
  label: string;
  retentionYears: number;
  requiresApplicatorLicense: boolean;
  requiresTargetPest: boolean;
  requiresApplicationRate: boolean;
  requiresTreatedArea: boolean;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductsPayload = { products: ProductView[]; lots: LotView[] };
export type ApplicationsPayload = { applications: ApplicationView[] };
export type ComplianceRulesPayload = { rules: ComplianceRuleView[] };

export type ComplianceReportRow = {
  applied_at: string;
  customer: string | null;
  site: string | null;
  address: string | null;
  product: string | null;
  epa_registration_number: string | null;
  lot_number: string | null;
  device: string | null;
  device_barcode: string | null;
  technician: string | null;
  applicator_license: string | null;
  method: string;
  target_pest: string | null;
  quantity: number;
  unit: string;
  application_rate: string | null;
  treated_area: string | null;
  location: string | null;
  note: string | null;
  supersedes: string | null;
};

export type ComplianceReportPayload = {
  rows: ComplianceReportRow[];
  count: number;
  truncated: boolean;
};

export type IpmPayload = {
  devices: DeviceView[];
  recentEvents: DeviceEventView[];
  sightings: SightingView[];
  properties: { id: string; accountId: string; label: string }[];
};

export type TechniciansPayload = { technicians: TechnicianView[] };

export type ServicePlansPayload = { plans: ServicePlanView[]; dueCount: number };

export type WorkOrdersPayload = {
  workOrders: WorkOrderView[];
  counts: { byStatus: Record<string, number>; total: number };
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
  opportunities: OpportunityView[];
  timeline: TimelineView[];
  timelineTruncated: boolean;
};
