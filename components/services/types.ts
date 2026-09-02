/**
 * The Services CRM wire shapes as the client reads them — the camelCase
 * views `lib/services/crm.ts` produces, mirrored once so the panels agree
 * with the routes about every field name.
 */

import type { ShowWhen } from "@/lib/services/form-conditions";

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
  ownerEmployeeId: string | null;
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
  branchId: string | null;
  reportsToId: string | null;
  hireDate: string | null;
  licenseExpiresOn: string | null;
  licenseState: string | null;
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
  /** Null until the plan is sequenced onto named dates (ADR-211). */
  cycleMonths: number | null;
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

export type LineView = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  createdAt: string;
};

/** An invoice line also says whether a person typed it (ADR-212). */
export type InvoiceLineView = LineView & {
  source: "manual" | "work_order" | "application";
};

export type EstimateView = {
  id: string;
  accountId: string;
  propertyId: string | null;
  opportunityId: string | null;
  number: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  validUntil: string | null;
  terms: string | null;
  notes: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: LineView[];
};

export type ContractView = {
  id: string;
  accountId: string;
  estimateId: string | null;
  planId: string | null;
  number: string;
  status: string;
  valueCents: number;
  startsOn: string;
  endsOn: string | null;
  autoRenew: boolean;
  terms: string | null;
  notes: string | null;
  signedAt: string | null;
  signedByName: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceView = {
  id: string;
  accountId: string;
  contractId: string | null;
  workOrderId: string | null;
  number: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issuedOn: string | null;
  dueOn: string | null;
  memo: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  lines: InvoiceLineView[];
};

export type PaymentView = {
  id: string;
  accountId: string;
  invoiceId: string;
  amountCents: number;
  method: string;
  reference: string | null;
  receivedAt: string;
  recordedAt: string;
  note: string | null;
};

export type RefundView = {
  id: string;
  paymentId: string;
  amountCents: number;
  reason: string;
  refundedAt: string;
  recordedAt: string;
};

export type EstimatesPayload = { estimates: EstimateView[]; openValueCents: number };

export type ContractsPayload = {
  contracts: ContractView[];
  activeValueCents: number;
  renewingCount: number;
};

export type InvoicesPayload = {
  invoices: InvoiceView[];
  outstandingCents: number;
  overdueCents: number;
  collectedCents: number;
};

export type PaymentsPayload = { payments: PaymentView[]; receivedCents: number };

export type RefundsPayload = { refunds: RefundView[]; refundedCents: number };

export type BranchView = {
  id: string;
  managerId: string | null;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timeZone: string | null;
  openedOn: string | null;
  closedOn: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  accountCount: number;
  staffCount: number;
  technicianCount: number;
};

export type EmployeeView = {
  id: string;
  branchId: string | null;
  reportsToId: string | null;
  hasLogin: boolean;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  title: string | null;
  hireDate: string | null;
  endDate: string | null;
  commissionBps: number | null;
  monthlyQuotaCents: number | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TerritoryView = {
  id: string;
  branchId: string;
  repId: string | null;
  name: string;
  code: string;
  city: string | null;
  region: string | null;
  postalCodes: string[];
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  accountCount: number;
};

export type CommissionView = {
  id: string;
  employeeId: string;
  opportunityId: string | null;
  contractId: string | null;
  invoiceId: string | null;
  basisCents: number;
  rateBps: number;
  amountCents: number;
  status: string;
  earnedOn: string;
  approvedAt: string | null;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BranchesPayload = {
  branches: BranchView[];
  counts: { total: number; active: number; unassignedAccounts: number };
};

export type EmployeesPayload = {
  employees: EmployeeView[];
  counts: { total: number; active: number; byRole: Record<string, number> };
};

export type TerritoriesPayload = {
  territories: TerritoryView[];
  counts: { total: number; active: number; unworked: number };
};

export type CommissionsPayload = {
  commissions: CommissionView[];
  totals: {
    accruedCents: number;
    approvedCents: number;
    paidCents: number;
    voidCents: number;
  };
};

export type LeaderboardRow = {
  employeeId: string;
  name: string;
  role: string;
  branchId: string | null;
  active: boolean;
  openCount: number;
  openValueCents: number;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  winRate: number | null;
  quotaCents: number | null;
  quotaAttainment: number | null;
  commissionAccruedCents: number;
  commissionPaidCents: number;
};

export type LeaderboardPayload = {
  rows: LeaderboardRow[];
  totals: {
    reps: number;
    wonValueCents: number;
    openValueCents: number;
    commissionPaidCents: number;
    unownedOpportunities: number;
  };
};

export type DocumentView = {
  id: string;
  accountId: string | null;
  propertyId: string | null;
  workOrderId: string | null;
  title: string;
  kind: string;
  storagePath: string;
  contentType: string | null;
  byteSize: number | null;
  notes: string | null;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvassRouteView = {
  id: string;
  territoryId: string | null;
  repId: string | null;
  name: string;
  status: string;
  walkedOn: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  knockCount: number;
  productiveCount: number;
};

export type KnockView = {
  id: string;
  canvassRouteId: string;
  accountId: string | null;
  address: string;
  disposition: string;
  knockedAt: string;
  followUpOn: string | null;
  note: string | null;
};

export type MarketingListView = {
  id: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  criteria: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  subscriberCount: number;
  unsubscribedCount: number;
};

export type CampaignView = {
  id: string;
  listId: string | null;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  budgetCents: number | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  openRate: number | null;
  clickRate: number | null;
};

export type AutomationView = {
  id: string;
  name: string;
  triggerOn: string;
  action: string;
  delayHours: number;
  template: string | null;
  active: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DocumentsPayload = {
  documents: DocumentView[];
  counts: { total: number; byKind: Record<string, number>; bytes: number };
};

export type CanvassingPayload = {
  routes: CanvassRouteView[];
  knocks: KnockView[];
  counts: {
    routes: number;
    knocks: number;
    productive: number;
    sold: number;
    productiveRate: number | null;
    byDisposition: Record<string, number>;
  };
};

export type MarketingListsPayload = {
  lists: MarketingListView[];
  counts: { total: number; active: number; members: number; unsubscribed: number };
};

export type CampaignsPayload = {
  campaigns: CampaignView[];
  counts: { total: number; messages: number; providerConnected: boolean };
};

export type AutomationsPayload = {
  automations: AutomationView[];
  counts: { total: number; active: number; runs: number };
  executorConnected: boolean;
};

export type AttributionPayload = {
  touches: {
    id: string;
    accountId: string;
    opportunityId: string | null;
    campaignId: string | null;
    knockId: string | null;
    source: string;
    medium: string | null;
    position: string;
    touchedAt: string;
    note: string | null;
  }[];
  firstTouch: Record<string, number>;
  lastTouch: Record<string, number>;
  counts: { total: number; accounts: number };
};

export type FormFieldView = {
  id: string;
  templateId: string;
  position: number;
  label: string;
  fieldType: string;
  required: boolean;
  helpText: string | null;
  options: string[];
  /** Asked only when an earlier question was answered a certain way (ADR-238). */
  dependsOnFieldId: string | null;
  showWhen: ShowWhen | null;
  createdAt: string;
};

export type FormTemplateView = {
  id: string;
  name: string;
  kind: string;
  version: number;
  description: string | null;
  active: boolean;
  /** New visits of these service types get this form assigned (ADR-238). */
  triggerServiceTypes: string[];
  createdAt: string;
  updatedAt: string;
  fields: FormFieldView[];
  inUse: boolean;
};

export type FormInstanceView = {
  id: string;
  templateId: string;
  accountId: string | null;
  propertyId: string | null;
  workOrderId: string | null;
  technicianId: string | null;
  status: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  signedByName: string | null;
  signedAt: string | null;
  signaturePath: string | null;
  signed: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimesheetView = {
  id: string;
  technicianId: string;
  workOrderId: string | null;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  workedMinutes: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FormsPayload = {
  templates: FormTemplateView[];
  instances: FormInstanceView[];
  counts: {
    templates: number;
    assigned: number;
    inProgress: number;
    completed: number;
    completedUnsigned: number;
  };
};

export type TimesheetsPayload = {
  shifts: TimesheetView[];
  counts: { total: number; running: number; workedMinutes: number };
};

export type LicencesPayload = {
  technicians: (TechnicianView & { daysRemaining: number | null; state: string })[];
  horizonDays: number;
  counts: {
    onRoster: number;
    current: number;
    expiring: number;
    expired: number;
    unrecorded: number;
    noLicence: number;
  };
};

/* --- the customer portal (increment 10) --------------------------------- */

export type PortalUserView = {
  id: string;
  accountId: string;
  accountName: string | null;
  contactId: string | null;
  linked: boolean;
  email: string;
  role: string;
  invitedAt: string;
  activatedAt: string | null;
  lastSeenAt: string | null;
  active: boolean;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type PortalRequestView = {
  id: string;
  accountId: string;
  propertyId: string | null;
  portalUserId: string | null;
  kind: string;
  status: string;
  summary: string;
  detail: string | null;
  preferredDate: string | null;
  response: string | null;
  workOrderId: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  open: boolean;
  answered: boolean;
  updatedAt: string;
};

export type PortalUsersPayload = {
  portalUsers: PortalUserView[];
  counts: {
    total: number;
    active: number;
    invited: number;
    suspended: number;
    neverSignedIn: number;
    accountsWithoutPortal: number;
  };
};

export type PortalRequestsPayload = {
  requests: PortalRequestView[];
  counts: {
    total: number;
    open: number;
    awaitingReply: number;
    byStatus: Record<string, number>;
  };
};

/* --- the operating dashboards (increment 11) ---------------------------- */

export type RevenueMonthView = {
  month: string;
  invoicedCents: number;
  collectedCents: number;
  refundedCents: number;
  netCents: number;
  invoiceCount: number;
  collectionRateBps: number | null;
};

export type ReceivableBucketView = {
  bucket: string;
  invoiceCount: number;
  balanceCents: number;
  overdue: boolean;
};

export type RetentionView = {
  customers: number;
  inactive: number;
  prospects: number;
  customersWithoutPlan: number;
  contractsActive: number;
  contractsEnded: number;
  retentionBps: number | null;
};

export type TechnicianProductivityView = {
  technicianId: string;
  firstName: string;
  lastName: string | null;
  name: string;
  branchId: string | null;
  active: boolean;
  scheduled: number;
  completed: number;
  cancelled: number;
  completionRateBps: number | null;
  workedMinutes: number | null;
  runningShifts: number;
};

export type RouteDayView = {
  day: string;
  technicianId: string;
  branchId: string | null;
  stops: number;
  firstStart: string | null;
  lastEnd: string | null;
  spanMinutes: number | null;
  bookedMinutes: number | null;
  idleMinutes: number | null;
  accounts: number;
};

export type ForecastMonthView = {
  month: string;
  recurringCents: number;
  contractedCents: number;
  totalCents: number;
  plans: number;
  contracts: number;
};

export type ForecastBasisView = {
  activePlans: number;
  unpricedPlans: number;
  activeContracts: number;
  openEndedContracts: number;
  customersWithoutPlan: number;
  pricedShareBps: number | null;
};

export type DashboardsPayload = {
  organizationId: string;
  windows: { months: number; productivityDays: number; routeDays: number; forecastMonths: number };
  revenue: {
    months: RevenueMonthView[];
    totals: { invoicedCents: number; collectedCents: number; refundedCents: number };
  };
  receivable: {
    buckets: ReceivableBucketView[];
    outstandingCents: number;
    overdueCents: number;
    undatedCents: number;
  };
  retention: RetentionView | null;
  productivity: {
    technicians: TechnicianProductivityView[];
    idle: number;
    runningShifts: number;
  };
  forecast: {
    months: ForecastMonthView[];
    basis: ForecastBasisView | null;
    assumptions: { churnApplied: boolean; growthApplied: boolean; basis: string };
  };
  routes: {
    days: RouteDayView[];
    optimization: { available: boolean; label: string };
  };
};

/* --- recurring billing and collections (increment 12) ------------------- */

export type BillingRunView = {
  id: string;
  throughOn: string;
  plansConsidered: number;
  invoicesCreated: number;
  plansAlreadyBilled: number;
  totalCents: number;
  note: string | null;
  ranAt: string;
};

export type DunningNoticeView = {
  id: string;
  invoiceId: string;
  accountId: string;
  action: string;
  daysOverdue: number;
  balanceCents: number;
  outcome: string | null;
  actedAt: string;
};

export type CollectionsInvoiceView = {
  invoiceId: string;
  accountId: string;
  accountName: string;
  number: string;
  balanceCents: number;
  dueOn: string;
  daysOverdue: number;
  bucket: string;
  notices: number;
  lastAction: string | null;
  lastActedAt: string | null;
  untouched: boolean;
};

export type BillingRunsPayload = {
  runs: BillingRunView[];
  counts: { total: number; invoicesCreated: number; billedCents: number; alreadyBilled: number };
  automatic: { available: boolean; label: string };
};

export type CollectionsPayload = {
  minDays: number;
  invoices: CollectionsInvoiceView[];
  notices: DunningNoticeView[];
  counts: { total: number; balanceCents: number; untouched: number; over90: number };
  delivery: { available: boolean; label: string };
};

/* --- equipment and fleet (increment 13) --------------------------------- */

export type FleetAssetView = {
  equipmentId: string;
  assetTag: string;
  name: string;
  kind: string;
  status: string;
  branchId: string | null;
  assignedTechnicianId: string | null;
  meterReading: number | null;
  meterUnit: string | null;
  lastServicedOn: string | null;
  serviceIntervalDays: number | null;
  nextServiceDue: string | null;
  daysUntilService: number | null;
  standing: string;
  events: number;
  unassigned: boolean;
};

export type EquipmentEventView = {
  id: string;
  equipmentId: string;
  kind: string;
  technicianId: string | null;
  meterReading: number | null;
  costCents: number | null;
  vendor: string | null;
  note: string | null;
  occurredAt: string;
};

export type FleetPayload = {
  fleet: FleetAssetView[];
  events: EquipmentEventView[];
  counts: {
    total: number;
    inService: number;
    inRepair: number;
    retired: number;
    overdue: number;
    dueSoon: number;
    unscheduled: number;
    unassigned: number;
  };
  telemetry: { available: boolean; label: string };
};

/** Where a lot's remainder physically sits, derived from the ledger (ADR-213). */
export type StockBalanceView = {
  lotId: string;
  branchId: string | null;
  equipmentId: string | null;
  quantity: number;
  locationKind: "branch" | "equipment";
  locationLabel: string;
};

export type StockPayload = {
  balances: StockBalanceView[];
  counts: { locations: number; lots: number };
};

/* --- nothing hidden (increment 30, ADR-232) ------------------------------ */

export type {
  DashboardRowView,
  DryRunRecordView,
  DryRunSummary,
  ScheduleAuditSummary,
  ScheduleFindingView,
} from "@/lib/services/nothing-hidden";
import type {
  DashboardRowView as DashboardRowViewT,
  DryRunRecordView as DryRunRecordViewT,
  DryRunSummary as DryRunSummaryT,
  ScheduleAuditSummary as ScheduleAuditSummaryT,
  ScheduleFindingView as ScheduleFindingViewT,
} from "@/lib/services/nothing-hidden";

export type ScheduleAuditPayload = {
  organizationId: string;
  window: { days: number };
  findings: ScheduleFindingViewT[];
  summary: ScheduleAuditSummaryT;
  ceiling: { findings: number; reached: boolean };
};

export type DryRunPayload = {
  automation: AutomationView;
  window: { days: number };
  records: DryRunRecordViewT[];
  summary: DryRunSummaryT;
  execution: { connected: boolean; label: string };
};

export type DashboardRowsPayload = {
  figure: string;
  key: string | null;
  window: { days: number };
  rows: DashboardRowViewT[];
  ceiling: { rows: number; reached: boolean };
};

/* --- the customer's side (increment 31, ADR-233) ------------------------- */

import type {
  PortalMessageView as PortalMessageViewT,
  RequestSlaView as RequestSlaViewT,
  SlaPolicyView as SlaPolicyViewT,
  SlaSummary as SlaSummaryT,
  SurveyResponseView as SurveyResponseViewT,
  SurveySummary as SurveySummaryT,
  MessageThreadSummary as MessageThreadSummaryT,
} from "@/lib/services/customers-side";

export type RequestSlaPayload = {
  window: { days: number };
  requests: RequestSlaViewT[];
  summary: SlaSummaryT;
  policies: SlaPolicyViewT[];
  ceiling: { requests: number; reached: boolean };
};

export type SurveysPayload = {
  window: { days: number };
  responses: SurveyResponseViewT[];
  summary: SurveySummaryT;
  ceiling: { responses: number; reached: boolean };
};

export type PortalMessagesPayload = {
  accountId: string | null;
  messages: PortalMessageViewT[];
  summary: MessageThreadSummaryT;
  ceiling: { messages: number; reached: boolean };
};
