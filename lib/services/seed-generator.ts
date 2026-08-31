/**
 * The full-scale CRM seed generator (task #63, owner /goal).
 *
 * Produces a deterministic, interconnected, clearly-fictional dataset large
 * enough to exercise every Services CRM surface end to end: at least 250
 * rows in every table the product writes, every nullable column populated
 * wherever it is logically valid, and the whole Lead → Customer → Property
 * → Plan → Work Order → IPM/Chemical → Compliance chain wired by real
 * foreign keys.
 *
 * Three properties make this safe to run against a real database:
 *
 *   1. **Deterministic.** A seeded PRNG drives every choice, so the same
 *      seed produces byte-identical data. A validation run and a
 *      production run describe the same rows.
 *   2. **Idempotent by identity.** Every naturally-unique value (account
 *      name, barcode, lot number, EPA registration, jurisdiction) is
 *      derived from its index, so re-running against a workspace that
 *      already holds the seed collides with the database's own unique
 *      constraints instead of silently doubling the book.
 *   3. **Fictional by construction.** Names are assembled from syllable
 *      tables, emails land on reserved `.example` domains, phones sit in
 *      the 555 range, and EPA registrations use a 90000-series prefix no
 *      real registration carries. Nothing here can reach a real person or
 *      name a real product.
 */

import { DEMO_SOURCE } from "@/lib/services/demo-data";

export const SEED_SCALES = ["demo", "full"] as const;
export type SeedScale = (typeof SEED_SCALES)[number];

/** Row targets per scale. `full` clears the goal's 250-row floor everywhere. */
export const SEED_TARGETS: Record<
  SeedScale,
  {
    accounts: number;
    technicians: number;
    products: number;
    jurisdictions: number;
    branches: number;
    employees: number;
    territories: number;
    canvassRoutes: number;
    marketingLists: number;
    campaigns: number;
    automations: number;
    formTemplates: number;
  }
> = {
  demo: {
    accounts: 40, technicians: 12, products: 14, jurisdictions: 8, branches: 4,
    employees: 14, territories: 8, canvassRoutes: 10, marketingLists: 6,
    campaigns: 8, automations: 8, formTemplates: 6,
  },
  full: {
    accounts: 320,
    technicians: 260,
    products: 260,
    jurisdictions: 260,
    branches: 260,
    employees: 340,
    territories: 300,
    canvassRoutes: 300,
    marketingLists: 260,
    campaigns: 280,
    automations: 260,
    formTemplates: 260,
  },
};

/* --------------------------------------------------------------- randomness */

/** mulberry32: small, fast, and identical across every JS runtime. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function pick<T>(random: Random, values: readonly T[]): T {
  return values[Math.floor(random() * values.length) % values.length];
}

function between(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function chance(random: Random, probability: number): boolean {
  return random() < probability;
}

/* ------------------------------------------------------------- vocabularies */

const COMPANY_HEADS = [
  "Harborlight", "Cascade", "Ironworks", "Stonebridge", "Rosewood", "Pineview",
  "Sunfield", "Bayside", "Meridian", "Northgate", "Silverbrook", "Fairhaven",
  "Copperline", "Larkspur", "Westmark", "Emberly", "Foxglove", "Granite Bay",
  "Thornhill", "Marlowe", "Bellweather", "Kestrel", "Aldergrove", "Quarry Hill",
] as const;
const COMPANY_TAILS = [
  "Foods Distribution", "Grill Group", "Hotel & Suites", "Grain Mill",
  "Senior Living", "School District", "Brewing Co", "Property Management",
  "Grocery Co-op", "Seafood Market", "Medical Center", "Logistics",
  "Bakery", "Data Center", "Fitness Club", "Veterinary Clinic",
  "Storage", "Auto Group", "Cold Storage", "Cannery",
] as const;
const FAMILY_NAMES = [
  "Alvarez", "Chen", "Okafor", "Whitfield", "Nakamura", "Petrov", "Silva",
  "Larsen", "Hassan", "Beaumont", "Rivera", "Kowalski", "Osei", "Lindqvist",
  "Ferreira", "Bhatt", "Novak", "Mwangi", "Rossi", "Delacroix", "Karlsen",
  "Ibarra", "Sandoval", "Ткач", "Yamada", "Boateng", "Fitzgerald", "Vasquez",
] as const;
const GIVEN_NAMES = [
  "Dana", "Marcus", "Priya", "Sam", "Owen", "Lucia", "Ruth", "Gloria", "Ben",
  "Hector", "Kelly", "Ava", "Noor", "Tom", "Carmen", "Wei", "Chidi", "June",
  "Miguel", "Aisha", "Pete", "Ingrid", "Rafael", "Nadia", "Theo", "Simone",
  "Yusuf", "Elena", "Kofi", "Mira", "Dmitri", "Rosa", "Elias", "Winnie",
] as const;
const CONTACT_ROLES = [
  "Facilities manager", "QA director", "Operations director", "General manager",
  "Chief engineer", "Executive housekeeper", "Plant manager", "Administrator",
  "Maintenance lead", "Grounds supervisor", "Store operations", "Owner",
  "Property manager", "Kitchen manager", "Compliance officer", "Night manager",
] as const;
const STREETS = [
  "Dock Road", "Cannery Row", "Pier Avenue", "Grand Boulevard", "Stonebridge Plaza",
  "Mill Race Road", "Rosewood Lane", "Schoolhouse Road", "Timber Trail",
  "Foundry Street", "Market Green", "Wharf Lane", "Maple Hollow Drive",
  "Fernbank Court", "Cedar Loop", "Larch Street", "Quarry Road", "Alder Way",
  "Juniper Terrace", "Basalt Avenue", "Kestrel Court", "Sable Ridge Road",
] as const;
const CITIES = [
  ["Portsview", "OR", "97001"], ["Alder Falls", "OR", "97010"],
  ["Basalt Creek", "OR", "97020"], ["Cedar Point", "WA", "98040"],
  ["Marrow Bay", "WA", "98055"], ["Fern Hollow", "OR", "97035"],
  ["Kestrel Flats", "ID", "83605"], ["Quarry Hill", "WA", "98070"],
] as const;
const PROPERTY_TYPES = [
  "warehouse", "cold storage", "restaurant", "hotel", "food processing",
  "assisted living", "school", "brewery", "multifamily", "grocery",
  "retail food", "single family", "office", "clinic", "data center", "gym",
] as const;
const RESIDENTIAL_LABELS = ["Home", "Residence", "Guest house", "Rental unit"] as const;
const COMMERCIAL_LABELS = [
  "Main Building", "Distribution Center", "Annex", "Kitchen", "Loading Dock",
  "Warehouse A", "Warehouse B", "Storefront", "Production Floor", "Back of House",
] as const;
const SERVICE_TYPES = [
  "Monthly IPM service", "Quarterly deep inspection", "Monthly kitchen service",
  "Bed bug retainer inspection", "Rodent exclusion follow-up", "Perimeter treatment",
  "Stored-product pest monitoring", "Fruit fly drain program", "Termite inspection",
  "Wildlife exclusion check", "Mosquito abatement", "Ant treatment",
] as const;
const PESTS = [
  "House mouse", "Norway rat", "Roof rat", "German cockroach", "American cockroach",
  "Odorous house ant", "Carpenter ant", "Pavement ant", "Indian meal moth",
  "Cigarette beetle", "Fruit flies", "Drain flies", "Yellowjacket", "Paper wasp",
  "Bed bug", "Subterranean termite", "Silverfish", "Earwig", "Cluster fly",
] as const;
const SOURCES = [
  "Referral", "Website", "Door knock", "Google search", "Yelp", "Trade show",
  "Existing customer expansion", "Property manager referral", "Direct mail",
  "Inbound call", "Partner agency", "Truck signage",
] as const;
const LOST_REASONS = [
  "Price; went with the incumbent vendor.", "Timing; revisit next budget cycle.",
  "Chose an in-house program.", "Site closed before the contract started.",
  "No decision by the stated deadline.", "Scope was larger than we service.",
] as const;
const ACTIVE_INGREDIENTS = [
  "Fipronil 0.05%", "Bifenthrin 7.9%", "Bromadiolone 0.005%", "Imidacloprid 21.4%",
  "Indoxacarb 0.6%", "Deltamethrin 0.06%", "Boric acid 5%", "Hydramethylnon 2.15%",
  "Difethialone 0.0025%", "Abamectin 0.05%", "Chlorfenapyr 21.45%", "Pyrethrins 1%",
] as const;
const PRODUCT_FORMS = [
  "Gel Bait", "Perimeter Concentrate", "Rodent Block", "Dust", "Aerosol",
  "Granular Bait", "Termiticide", "Growth Regulator", "Foam", "Wettable Powder",
] as const;
const DEVICE_TYPES = [
  "bait_station", "snap_trap", "multi_catch", "insect_light_trap",
  "pheromone_trap", "other",
] as const;
const DEVICE_CONDITIONS = ["ok", "needs_service", "damaged", "missing"] as const;
const APPLICATION_METHODS = [
  "bait", "crack_and_crevice", "spot", "perimeter", "broadcast", "void",
  "dust", "fumigation", "other",
] as const;
/** The measure units the schema accepts; used here to type the shapes below. */
type SeedUnit = "oz" | "fl_oz" | "lb" | "g" | "kg" | "ml" | "l" | "gal" | "each";
const RECURRENCES = [
  "weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "annual",
] as const;
const OPPORTUNITY_SUBJECTS = [
  "Annual IPM program", "Quarterly service agreement", "Rodent exclusion retrofit",
  "Bed bug heat treatment", "Termite pre-treatment", "Monthly kitchen service",
  "Wildlife exclusion package", "Mosquito season program", "One-time cleanout",
  "Portfolio-wide service agreement", "Bird deterrent installation",
] as const;
const LOCATION_NOTES = [
  "North fence line, post 1", "Dock door 3, interior left", "Dock door 7, interior right",
  "Behind the dumpster corral", "Mechanical room, east wall", "Under the prep sink",
  "Dish pit, under the counter", "Attic access above the hallway", "Crawlspace, north end",
  "Loading court, east wall", "Break room, behind the vending machine", "Roof, HVAC curb",
] as const;
const TREATED_AREAS = [
  "Perimeter, 240 linear ft", "Perimeter, 620 linear ft", "Kitchen, cracks and voids",
  "Dish pit and line", "12 exterior stations, north fence line", "Attic, 900 sq ft",
  "Crawlspace, 1,400 sq ft", "Dumpster pad and surrounds", "Loading dock aprons",
] as const;
const APPLICATION_RATES = [
  "0.5 fl oz per gallon", "1 oz per 1,000 sq ft", "Pea-sized placements",
  "1 block per station", "2 g per void", "Label rate, low volume",
  "0.25 fl oz per gallon", "4 oz per 1,000 sq ft",
] as const;

/* ---------------------------------------------------------------- utilities */

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** A 555-range phone, deterministic in its index — never a real number. */
function phoneFor(index: number): string {
  return `(555) ${pad(100 + (index % 800), 3)}-${pad(index % 10000, 4)}`;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------- shapes */

export type SeedAccount = {
  index: number;
  name: string;
  kind: "residential" | "commercial";
  statusPath: readonly ("prospect" | "customer" | "inactive")[];
  email: string;
  phone: string;
  billingAddress: string;
  notes: string;
  source: string;
  contacts: { firstName: string; lastName: string; role: string; email: string; phone: string }[];
  properties: { label: string; address: string; propertyType: string; accessNotes: string }[];
  opportunities: {
    name: string;
    valueCents: number;
    stagePath: readonly string[];
    expectedInDays: number;
    notes: string;
    lostReason?: string;
  }[];
  events: { kind: string; summary: string; detail: string; daysAgo: number }[];
  /*
   * Where this account sits in the company. Assigned once every branch,
   * territory and rep exists, so the indices always resolve. A minority are
   * left unassigned on purpose: a real book has customers nobody has
   * claimed yet, and a page that never sees one is not tested.
   */
  branchIndex?: number;
  territoryIndex?: number;
  ownerEmployeeIndex?: number;
  /** The owner's own rate, so a commission is earned at the rate they carry. */
  ownerCommissionBps?: number;
  /** Increment 8: what is filed about this customer, and how they arrived. */
  documents?: {
    title: string;
    kind:
      | "contract" | "estimate" | "photo" | "inspection_report" | "service_report"
      | "permit" | "license" | "invoice" | "other";
    storagePath: string;
    contentType: string;
    byteSize: number;
    notes: string;
    propertySeat?: number;
    visitSeat?: number;
    uploadedDaysAgo: number;
  }[];
  listSeats?: { listIndex: number; source: string; addedDaysAgo: number; unsubscribedDaysAgo?: number; unsubscribeReason?: string }[];
  touches?: {
    source: string;
    medium: string;
    position: "first" | "assist" | "last";
    touchedDaysAgo: number;
    campaignIndex?: number;
    note: string;
  }[];
  /** Increment 9: the inspections and reports filled out about this customer. */
  forms?: {
    templateIndex: number;
    propertySeat?: number;
    visitSeat?: number;
    technicianIndex: number;
    status: "assigned" | "in_progress" | "completed" | "void";
    assignedDaysAgo: number;
    /** Completed forms answer everything; the trigger insists on it. */
    answerEvery: boolean;
    signedByName?: string;
    notes: string;
  }[];
};



export type SeedTechnician = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  active: boolean;
  branchIndex?: number;
  reportsToIndex?: number;
  hiredDaysAgo?: number;
  /*
   * Increment 9. Shifts are laid end to end — one per calendar day — because
   * the database refuses two shifts that overlap, and a seeder producing one
   * would be testing that guard rather than the book.
   */
  shifts?: { startedDaysAgo: number; startHour: number; hours: number; breakMinutes: number; open: boolean; notes: string }[];
  /** Negative once lapsed; absent means no expiry on file, which is its own state. */
  licenceExpiresInDays?: number;
  licenceState?: string;
};

export type SeedBranch = {
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  timeZone: string;
  openedDaysAgo: number;
  /** A closed branch keeps its history; the schema refuses to call it open. */
  closedDaysAgo?: number;
  active: boolean;
  notes: string;
  /** Filled once the org chart exists — a branch is managed by a person. */
  managerIndex?: number;
};

export type SeedEmployee = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "owner" | "branch_manager" | "sales_manager" | "sales_rep" | "csr" | "dispatcher" | "admin";
  title: string;
  branchIndex?: number;
  reportsToIndex?: number;
  hiredDaysAgo: number;
  endedDaysAgo?: number;
  active: boolean;
  commissionBps?: number;
  monthlyQuotaCents?: number;
  notes: string;
};

export type SeedTerritory = {
  code: string;
  name: string;
  branchIndex: number;
  repIndex?: number;
  city: string;
  region: string;
  postalCodes: string[];
  active: boolean;
  notes: string;
};

export type SeedProduct = {
  name: string;
  epaRegistrationNumber: string;
  activeIngredient: string;
  signalWord: "CAUTION" | "WARNING" | "DANGER";
  sdsUrl: string;
  labelUrl: string;
  restrictedUse: boolean;
  defaultUnit: SeedUnit;
  active: boolean;
  lots: { lotNumber: string; quantity: number; receivedDaysAgo: number; expiresInDays: number }[];
};

export type SeedJurisdiction = {
  jurisdiction: string;
  label: string;
  retentionYears: number;
  requiresApplicatorLicense: boolean;
  requiresTargetPest: boolean;
  requiresApplicationRate: boolean;
  requiresTreatedArea: boolean;
  notes: string;
  active: boolean;
};

export type SeedCanvassRoute = {
  name: string;
  territoryIndex?: number;
  repIndex?: number;
  status: "planned" | "walking" | "complete" | "cancelled";
  walkedDaysAgo: number;
  notes: string;
  knocks: {
    address: string;
    disposition:
      | "no_answer" | "not_home" | "not_interested" | "callback"
      | "appointment_set" | "sold" | "do_not_knock";
    minutesIn: number;
    /** Only a door that sold names the customer it produced. */
    accountIndex?: number;
    followUpInDays?: number;
    note: string;
  }[];
};

export type SeedMarketingList = {
  name: string;
  description: string;
  isDynamic: boolean;
  criteria?: string;
  active: boolean;
};

export type SeedCampaign = {
  name: string;
  listIndex?: number;
  channel: "email" | "sms" | "postcard";
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  subject?: string;
  body: string;
  budgetCents: number;
  scheduledDaysAgo?: number;
  sentDaysAgo?: number;
  /** Recipients are taken from the book at this stride, deterministically. */
  recipientStride: number;
  recipientCount: number;
};

export type SeedAutomation = {
  name: string;
  triggerOn:
    | "lead_created" | "service_completed" | "invoice_overdue"
    | "contract_renewing" | "sighting_recorded" | "estimate_sent";
  action: "send_email" | "send_sms" | "create_task" | "notify_manager" | "schedule_followup";
  delayHours: number;
  template?: string;
  active: boolean;
};

export type SeedFormTemplate = {
  name: string;
  kind: "inspection" | "service_report" | "compliance_checklist" | "wdo_report" | "safety_check" | "other";
  version: number;
  description: string;
  active: boolean;
  fields: {
    label: string;
    fieldType: "text" | "long_text" | "number" | "boolean" | "date" | "select" | "multi_select";
    required: boolean;
    helpText: string;
    options?: string[];
  }[];
};

export type SeedDataset = {
  scale: SeedScale;
  accounts: SeedAccount[];
  technicians: SeedTechnician[];
  products: SeedProduct[];
  jurisdictions: SeedJurisdiction[];
  branches: SeedBranch[];
  employees: SeedEmployee[];
  territories: SeedTerritory[];
  canvassRoutes: SeedCanvassRoute[];
  marketingLists: SeedMarketingList[];
  campaigns: SeedCampaign[];
  automations: SeedAutomation[];
  formTemplates: SeedFormTemplate[];
};

/* ---------------------------------------------------------------- generators */

function addressFor(random: Random, _index: number): string {
  const [city, state, zip] = pick(random, CITIES);
  return `${between(random, 1, 9800)} ${pick(random, STREETS)}, ${city}, ${state} ${zip}`;
}

function generateAccount(random: Random, index: number): SeedAccount {
  // Roughly three residential to two commercial, as a real book runs.
  const kind = index % 5 < 3 ? "residential" : "commercial";
  const name =
    kind === "commercial"
      ? `${COMPANY_HEADS[index % COMPANY_HEADS.length]} ${COMPANY_TAILS[(index * 7) % COMPANY_TAILS.length]} ${pad(index, 3)}`
      : `The ${FAMILY_NAMES[index % FAMILY_NAMES.length]} Household ${pad(index, 3)}`;
  const domain = `${slug(name)}.example`;

  /*
   * Lifecycle spread: a real book is mostly customers, with live leads and
   * prospects at the front and a tail of churned accounts. Every status is
   * represented, and every account walks its path move by move so the
   * database writes the history.
   */
  const lifecycleRoll = index % 10;
  const statusPath: readonly ("prospect" | "customer" | "inactive")[] =
    lifecycleRoll === 0 ? []
    : lifecycleRoll <= 2 ? (["prospect"] as const)
    : lifecycleRoll <= 8 ? (["prospect", "customer"] as const)
    : (["prospect", "customer", "inactive"] as const);

  const contactCount = kind === "commercial" ? between(random, 2, 4) : between(random, 1, 2);
  const contacts = Array.from({ length: contactCount }, (_, seat) => {
    const firstName = GIVEN_NAMES[(index + seat * 5) % GIVEN_NAMES.length];
    const lastName = FAMILY_NAMES[(index + seat * 3) % FAMILY_NAMES.length];
    return {
      firstName,
      lastName,
      role: kind === "commercial" ? pick(random, CONTACT_ROLES) : "Homeowner",
      email: `${slug(firstName)}.${slug(lastName)}${index}${seat}@${domain}`,
      phone: phoneFor(index * 10 + seat),
    };
  });

  const propertyCount = kind === "commercial" ? between(random, 1, 4) : 1;
  const properties = Array.from({ length: propertyCount }, (_, seat) => ({
    label:
      kind === "commercial"
        ? `${COMMERCIAL_LABELS[(index + seat) % COMMERCIAL_LABELS.length]} ${pad(seat + 1, 2)}`
        : RESIDENTIAL_LABELS[(index + seat) % RESIDENTIAL_LABELS.length],
    address: addressFor(random, index * 10 + seat),
    propertyType:
      kind === "commercial"
        ? PROPERTY_TYPES[(index + seat) % PROPERTY_TYPES.length]
        : "single family",
    accessNotes:
      kind === "commercial"
        ? `Check in at the office; ${pick(random, ["hi-vis required", "hairnet required on the floor", "escort required past the dock", "badge from engineering"])}.`
        : `Gate code ${pad(between(random, 1000, 9999), 4)}; ${pick(random, ["friendly dog in the yard", "side gate latch sticks", "leave the invoice in the door", "call ahead for the alarm"])}.`,
  }));

  // A won deal for most customers, plus open and lost work across the book.
  const opportunityCount = between(random, 1, 3);
  const opportunities = Array.from({ length: opportunityCount }, (_, seat) => {
    /*
     * Seven outcomes so every stage rests somewhere: a deal that has not
     * been touched yet, one at each middle stage, and both closes. A board
     * missing a column reads as a bug in the product rather than a gap in
     * the data.
     */
    const outcomeRoll = (index + seat) % 7;
    const stagePath =
      outcomeRoll === 0 ? ([] as const)
      : outcomeRoll === 1 ? (["contacted"] as const)
      : outcomeRoll === 2 ? (["contacted", "inspection"] as const)
      : outcomeRoll === 3 ? (["contacted", "inspection", "proposal"] as const)
      : outcomeRoll === 4 ? (["contacted", "inspection", "proposal", "negotiation"] as const)
      : outcomeRoll === 5 ? (["contacted", "inspection", "proposal", "won"] as const)
      : (["contacted", "proposal", "lost"] as const);
    return {
      name: `${OPPORTUNITY_SUBJECTS[(index + seat * 3) % OPPORTUNITY_SUBJECTS.length]} ${pad(index, 3)}-${seat + 1}`,
      valueCents:
        kind === "commercial"
          ? between(random, 180, 4200) * 1000
          : between(random, 35, 320) * 1000,
      stagePath,
      expectedInDays: between(random, -60, 90),
      notes: `Scoped from the ${pick(random, ["walkthrough", "site survey", "phone intake", "inspection report"])}; ${pick(random, ["decision with the facilities committee", "owner decides directly", "pending budget approval", "renewal window"])}.`,
      ...(stagePath.at(-1) === "lost" ? { lostReason: pick(random, LOST_REASONS) } : {}),
    };
  });

  const eventCount = between(random, 3, 7);
  const events = Array.from({ length: eventCount }, () => {
    const kindOfEvent = pick(random, ["note", "call", "email", "sms", "task"] as const);
    const pest = pick(random, PESTS);
    return {
      kind: kindOfEvent,
      summary:
        kindOfEvent === "call" ? `Inbound call about ${pest.toLowerCase()} activity.`
        : kindOfEvent === "email" ? `Sent the ${pick(random, ["service summary", "proposal", "inspection report", "renewal notice"])}.`
        : kindOfEvent === "sms" ? `Texted the arrival window for the next visit.`
        : kindOfEvent === "task" ? `Follow up on ${pick(random, ["the exclusion quote", "the sanitation recommendation", "the renewal", "the trap check"])}.`
        : `Walkthrough notes: ${pest.toLowerCase()} pressure at the ${pick(random, ["dock", "kitchen", "perimeter", "storage room", "crawlspace"])}.`,
      detail: `Recorded by the ${pick(random, ["route technician", "office", "branch manager", "inspector"])} during the ${pick(random, ["morning route", "afternoon route", "scheduled inspection", "callback visit"])}.`,
      daysAgo: between(random, 1, 900),
    };
  });

  return {
    index,
    name,
    kind,
    statusPath,
    email: `office@${domain}`,
    phone: phoneFor(index),
    billingAddress: addressFor(random, index),
    notes: `${kind === "commercial" ? "Commercial account" : "Residential account"} — ${pick(random, ["service window before 10:00 only", "low-odor products only", "invoices roll up to the group office", "gate code on file, notify on arrival", "audit-ready documentation required"])}.`,
    source: pick(random, SOURCES),
    contacts,
    properties,
    opportunities,
    events,
  };
}

function generateTechnician(_random: Random, index: number): SeedTechnician {
  const firstName = GIVEN_NAMES[index % GIVEN_NAMES.length];
  const lastName = FAMILY_NAMES[(index * 3) % FAMILY_NAMES.length];
  return {
    firstName,
    lastName,
    email: `${slug(firstName)}.${slug(lastName)}${index}@demo-pest-services.example`,
    phone: phoneFor(20_000 + index),
    licenseNumber: `DEMO-APP-${pad(10_000 + index, 5)}`,
    // A real roster carries a tail of departed technicians whose history stays.
    active: index % 11 !== 0,
  };
}

function generateProduct(random: Random, index: number): SeedProduct {
  const form = PRODUCT_FORMS[index % PRODUCT_FORMS.length];
  const ingredient = ACTIVE_INGREDIENTS[index % ACTIVE_INGREDIENTS.length];
  const unit =
    form.includes("Concentrate") || form === "Aerosol" || form === "Foam" ? "fl_oz"
    : form === "Rodent Block" || form === "Granular Bait" || form === "Wettable Powder" ? "lb"
    : "oz";
  const lotCount = between(random, 1, 3);
  return {
    name: `Demo ${form} ${pad(index, 3)}`,
    // 90000-series: the regulator's grammar, a prefix no real registration uses.
    epaRegistrationNumber: `9${pad(index % 10000, 4)}-${pad(100 + (index % 900), 3)}`,
    activeIngredient: ingredient,
    signalWord: pick(random, ["CAUTION", "WARNING", "DANGER"] as const),
    sdsUrl: `https://sds.demo-pest-services.example/${slug(form)}-${pad(index, 3)}.pdf`,
    labelUrl: `https://labels.demo-pest-services.example/${slug(form)}-${pad(index, 3)}.pdf`,
    restrictedUse: index % 7 === 0,
    defaultUnit: unit as SeedUnit,
    active: index % 13 !== 0,
    lots: Array.from({ length: lotCount }, (_, seat) => ({
      lotNumber: `DEMO-LOT-${pad(index, 3)}-${pad(seat + 1, 2)}`,
      quantity: between(random, 12, 240),
      receivedDaysAgo: between(random, 10, 700),
      expiresInDays: between(random, 60, 900),
    })),
  };
}

/**
 * Jurisdictions as a multi-state operator really configures them: states,
 * provinces, and the county and city programs that add their own rules.
 * The code grammar is the schema's; the bodies are fictional.
 */
const STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
] as const;
const PROVINCE_CODES = ["AB","BC","MB","NB","NL","NS","ON","PE","QC","SK","NT","NU","YT"] as const;

function generateJurisdiction(random: Random, index: number): SeedJurisdiction {
  let code: string;
  let label: string;
  if (index < STATE_CODES.length) {
    code = `US-${STATE_CODES[index]}`;
    label = `${STATE_CODES[index]} Department of Agriculture (Demo Data)`;
  } else if (index < STATE_CODES.length + PROVINCE_CODES.length) {
    const province = PROVINCE_CODES[index - STATE_CODES.length];
    code = `CA-${province}`;
    label = `${province} Ministry of the Environment (Demo Data)`;
  } else {
    // County and city programs, coded within the schema's grammar.
    const seat = index - STATE_CODES.length - PROVINCE_CODES.length;
    const state = STATE_CODES[seat % STATE_CODES.length];
    code = `US-${state}${pad(seat, 3)}`;
    label = `${state} County Program ${pad(seat, 3)} (Demo Data)`;
  }
  return {
    jurisdiction: code,
    label,
    retentionYears: pick(random, [2, 3, 5, 7, 10]),
    requiresApplicatorLicense: true,
    requiresTargetPest: index % 2 === 0,
    requiresApplicationRate: index % 3 === 0,
    requiresTreatedArea: index % 4 === 0,
    notes: `Configured for the demonstration book; retention and required fields follow this program's published rule set.`,
    active: index % 17 !== 0,
  };
}

/** Build the whole dataset for a scale. Deterministic in `seed`. */
export function generateSeedDataset(scale: SeedScale, seed = 20260830): SeedDataset {
  const targets = SEED_TARGETS[scale];
  const random = makeRandom(seed);

  /*
   * The company is built first, because everything else takes its place in
   * it: a branch serves accounts, a rep owns them, a territory covers them.
   * Branches carry no manager yet — the org chart does not exist until the
   * next line — so the managers are attached in a second pass below, the
   * same way the database has to declare one of those two directions last.
   */
  const branches = Array.from({ length: targets.branches }, (_, index) =>
    generateBranch(random, index),
  );
  const employees = Array.from({ length: targets.employees }, (_, index) =>
    generateEmployee(random, index, branches.length),
  );
  const branchManagers = employees
    .map((employee, index) => ({ employee, index }))
    .filter((entry) => entry.employee.role === "branch_manager")
    .map((entry) => entry.index);
  const salesReps = employees
    .map((employee, index) => ({ employee, index }))
    .filter((entry) => entry.employee.role === "sales_rep" || entry.employee.role === "sales_manager")
    .map((entry) => entry.index);

  for (const [index, branch] of branches.entries()) {
    if (branchManagers.length === 0) continue;
    branch.managerIndex = branchManagers[index % branchManagers.length];
  }

  const territories = Array.from({ length: targets.territories }, (_, index) =>
    generateTerritory(random, index, branches.length, salesReps),
  );

  const accounts = Array.from({ length: targets.accounts }, (_, index) =>
    generateAccount(random, index),
  );
  for (const account of accounts) {
    if (branches.length > 0) account.branchIndex = account.index % branches.length;
    // A nineteenth of the book sits outside any territory and a thirteenth
    // has no owner: unassigned is a real state, and the pages that report
    // it need rows to report.
    if (territories.length > 0 && account.index % 19 !== 0) {
      account.territoryIndex = account.index % territories.length;
    }
    if (salesReps.length > 0 && account.index % 13 !== 0) {
      const repIndex = salesReps[account.index % salesReps.length];
      account.ownerEmployeeIndex = repIndex;
      account.ownerCommissionBps = employees[repIndex].commissionBps;
    }
  }

  const technicians = Array.from({ length: targets.technicians }, (_, index) =>
    generateTechnician(random, index),
  );
  for (const [index, technician] of technicians.entries()) {
    if (branches.length > 0) technician.branchIndex = index % branches.length;
    if (branchManagers.length > 0) {
      technician.reportsToIndex = branchManagers[index % branchManagers.length];
    }
    technician.hiredDaysAgo = between(random, 45, 3600);
    technician.shifts = generateShifts(random, index, 3);
    /*
     * Expired, expiring inside the horizon, comfortably current — and every
     * seventh left with no expiry on file at all, because an unrecorded
     * licence is a real state and folding it into "current" is how a
     * compliance report becomes a liability.
     */
    if (index % 7 !== 0) {
      technician.licenceExpiresInDays =
        index % 3 === 0 ? -between(random, 1, 200)
        : index % 3 === 1 ? between(random, 1, 55)
        : between(random, 120, 900);
      technician.licenceState = ["OR", "WA", "ID"][index % 3];
    }
  }

  const marketingLists = Array.from({ length: targets.marketingLists }, (_, index) =>
    generateMarketingList(random, index),
  );
  const campaigns = Array.from({ length: targets.campaigns }, (_, index) =>
    generateCampaign(random, index, marketingLists.length),
  );
  const automations = Array.from({ length: targets.automations }, (_, index) =>
    generateAutomation(random, index),
  );
  const canvassRoutes = Array.from({ length: targets.canvassRoutes }, (_, index) =>
    generateCanvassRoute(random, index, territories.length, salesReps, accounts.length),
  );
  const formTemplates = Array.from({ length: targets.formTemplates }, (_, index) =>
    generateFormTemplate(random, index),
  );

  /*
   * The paper each customer carries, the lists they consented to, and how
   * they arrived. Attached in a second pass because a touch can name a
   * campaign, and campaigns did not exist when the accounts were built.
   */
  for (const account of accounts) {
    const serviced = account.statusPath.includes("customer");
    account.documents = Array.from(
      { length: serviced ? between(random, 1, 4) : between(random, 0, 1) },
      (_, seat) => {
        const kind = DOCUMENT_KINDS[(account.index + seat) % DOCUMENT_KINDS.length];
        return {
          title: `${DOCUMENT_TITLES[kind]} ${pad(seat + 1, 2)}`,
          kind,
          // A private path, never a link — the schema refuses anything with
          // a scheme in it.
          storagePath: `services/${pad(account.index, 4)}/${kind}-${pad(seat, 2)}.pdf`,
          contentType: pick(random, CONTENT_TYPES),
          byteSize: between(random, 12, 9000) * 1024,
          notes: `Filed ${pick(random, ["after the site walk", "by the office", "from the technician's phone", "at signature"])}.`,
          ...(account.properties.length > 0 ? { propertySeat: seat % account.properties.length } : {}),
          ...(serviced && seat % 2 === 0 ? { visitSeat: seat } : {}),
          uploadedDaysAgo: between(random, 1, 800),
        };
      },
    );

    account.listSeats =
      marketingLists.length === 0
        ? []
        : Array.from({ length: 1 + (account.index % 2) }, (_, seat) => {
            const addedDaysAgo = between(random, 30, 900);
            // Roughly one in nine has withdrawn consent, and the moment it
            // happened is kept rather than the row being removed.
            const gone = (account.index + seat) % 9 === 0;
            return {
              listIndex: (account.index * 3 + seat) % marketingLists.length,
              source: pick(random, ["website form", "phone intake", "door knock", "referral", "import"]),
              addedDaysAgo,
              ...(gone
                ? {
                    unsubscribedDaysAgo: Math.max(1, addedDaysAgo - between(random, 10, 400)),
                    unsubscribeReason: pick(random, [
                      "Asked to be removed by phone.",
                      "Clicked unsubscribe.",
                      "No longer a customer.",
                      "Too many messages.",
                    ]),
                  }
                : {}),
            };
          });

    /*
     * The forms filled out about this customer. A completed form answers
     * every question, because the database counts the required ones and
     * refuses the difference — a seeder that skipped one would be testing
     * the trigger rather than the book.
     */
    account.forms =
      !serviced || formTemplates.length === 0
        ? []
        : Array.from({ length: between(random, 1, 3) }, (_, seat) => {
            const roll = (account.index + seat) % 7;
            const status = (
              roll === 0 ? "assigned"
              : roll === 1 ? "in_progress"
              : roll === 6 ? "void"
              : "completed"
            ) as NonNullable<SeedAccount["forms"]>[number]["status"];
            return {
              templateIndex: (account.index * 3 + seat) % formTemplates.length,
              ...(account.properties.length > 0 ? { propertySeat: seat % account.properties.length } : {}),
              ...(seat % 2 === 0 ? { visitSeat: seat } : {}),
              technicianIndex: (account.index + seat) % Math.max(1, targets.technicians),
              status,
              assignedDaysAgo: between(random, 2, 700),
              answerEvery: status === "completed",
              // A signed form is the norm on a completed inspection and
              // absent everywhere else, which is what makes the unsigned
              // count on the forms page mean something.
              ...(status === "completed" && (account.index + seat) % 5 !== 0
                ? { signedByName: `${account.contacts[0]?.firstName ?? "Alex"} ${account.contacts[0]?.lastName ?? "Reyes"}` }
                : {}),
              notes: `${pick(random, ["Filled out on site", "Completed at the truck", "Reviewed with the customer", "Sent to the branch"])}.`,
            };
          });

    account.touches = Array.from({ length: between(random, 1, 3) }, (_, seat) => ({
      source: pick(random, ["google", "referral", "door knock", "yard sign", "facebook", "repeat customer"]),
      medium: pick(random, ["organic", "paid", "canvassing", "word of mouth", "email"]),
      position: (seat === 0 ? "first" : seat === 1 ? "assist" : "last") as "first" | "assist" | "last",
      touchedDaysAgo: between(random, 5, 1100),
      ...(campaigns.length > 0 && (account.index + seat) % 4 === 0
        ? { campaignIndex: (account.index + seat) % campaigns.length }
        : {}),
      note: `${pick(random, ["First contact", "Nurtured through the season", "Closed on this touch", "Re-engaged after a lapse"])}.`,
    }));
  }

  return {
    scale,
    accounts,
    technicians,
    products: Array.from({ length: targets.products }, (_, index) => generateProduct(random, index)),
    jurisdictions: Array.from({ length: targets.jurisdictions }, (_, index) => generateJurisdiction(random, index)),
    branches,
    employees,
    territories,
    canvassRoutes,
    marketingLists,
    campaigns,
    automations,
    formTemplates,
  };
}

/* ------------------------------------------------- per-account operational data */

export type SeedPlan = {
  propertyIndex: number;
  serviceType: string;
  recurrence: (typeof RECURRENCES)[number];
  dueInDays: number;
  technicianIndex: number;
  valueCents: number;
  notes: string;
  active: boolean;
};

export type SeedVisit = {
  propertyIndex: number;
  serviceType: string;
  inDays: number;
  durationHours: number;
  technicianIndex: number;
  statusPath: readonly string[];
  instructions: string;
  completionNotes: string;
  /** The recurring plan this visit came from, when one covers the site. */
  planIndex?: number;
};

export type SeedDeviceScanLink = {
  /** The completed visit this scan was performed on, when it was. */
  visitIndex?: number;
};

export type SeedDevice = {
  propertyIndex: number;
  label: string;
  deviceType: (typeof DEVICE_TYPES)[number];
  barcode: string;
  installedDaysAgo: number;
  locationNote: string;
  activityThreshold: number;
  scans: {
    event: "service" | "move" | "remove";
    daysAgo: number;
    condition: (typeof DEVICE_CONDITIONS)[number];
    activityCount: number;
    pestObserved: string;
    locationNote: string;
    note: string;
    visitIndex?: number;
  }[];
};

export type SeedSighting = {
  propertyIndex: number;
  pest: string;
  severity: "low" | "moderate" | "high";
  daysAgo: number;
  locationNote: string;
  note: string;
  correctiveAction?: string;
  correctedDaysAgo?: number;
};

export type SeedApplication = {
  propertyIndex: number;
  productIndex: number;
  lotIndex: number;
  technicianIndex: number;
  deviceIndex?: number;
  /** The completed visit this application was performed on. */
  visitIndex?: number;
  /** A correction supersedes the application at this index in the account. */
  supersedesIndex?: number;
  method: (typeof APPLICATION_METHODS)[number];
  quantity: number;
  daysAgo: number;
  targetPest: string;
  applicationRate: string;
  treatedArea: string;
  locationNote: string;
  note: string;
};

export type SeedBilling = {
  estimates: {
    number: string;
    status: "draft" | "sent" | "accepted" | "declined" | "expired";
    lines: { description: string; quantity: number; unitPriceCents: number }[];
    taxCents: number;
    validInDays: number;
    terms: string;
    notes: string;
    sentDaysAgo: number;
    decidedDaysAgo?: number;
    propertyIndex: number;
    opportunityIndex?: number;
  }[];
  contracts: {
    number: string;
    status: "active" | "ended" | "cancelled";
    estimateIndex?: number;
    planIndex?: number;
    valueCents: number;
    startsInDays: number;
    endsInDays: number;
    autoRenew: boolean;
    terms: string;
    notes: string;
    signedDaysAgo?: number;
    signedByName?: string;
    endedDaysAgo?: number;
  }[];
  /**
   * What the sale earned the person who made it. The amount is deliberately
   * absent: the database multiplies the basis by the rate, and a seeded
   * payout that stated its own total would be asserting the one number this
   * schema refuses to take from a caller.
   */
  commissions: {
    opportunityIndex?: number;
    contractIndex?: number;
    invoiceIndex?: number;
    basisCents: number;
    rateBps: number;
    status: "accrued" | "approved" | "paid" | "void";
    earnedDaysAgo: number;
    note: string;
  }[];
  invoices: {
    number: string;
    status: "draft" | "open" | "void" | "uncollectible";
    contractIndex?: number;
    visitIndex?: number;
    lines: { description: string; quantity: number; unitPriceCents: number }[];
    taxCents: number;
    issuedDaysAgo: number;
    /** Net terms in days from the issue date. */
    netDays: number;
    memo: string;
    voidReason?: string;
    /** Payments against this invoice, in cents; empty means unpaid. */
    payments: {
      amountCents: number;
      method: "card" | "ach" | "check" | "cash" | "other";
      reference: string;
      daysAgo: number;
      note: string;
      refund?: { amountCents: number; reason: string; daysAgo: number };
    }[];
  }[];
};

export type SeedOperations = {
  plans: SeedPlan[];
  visits: SeedVisit[];
  devices: SeedDevice[];
  sightings: SeedSighting[];
  applications: SeedApplication[];
  billing: SeedBilling;
};

/**
 * The operational layer for one account, generated from its own index so a
 * re-run reproduces it exactly. Only accounts that reached `customer` carry
 * plans, visits, stations and applications — a lead has no service history,
 * and inventing one would make the book read falsely.
 */
export function generateOperations(
  account: SeedAccount,
  dataset: SeedDataset,
  seed = 20260830,
): SeedOperations {
  const random = makeRandom(seed + account.index * 7919);
  const serviced = account.statusPath.includes("customer");
  if (!serviced) {
    /*
     * A lead has no service history — but it may well have been quoted,
     * and a declined estimate is exactly how a book records the ones that
     * got away. So prospects and leads carry paper without operations.
     */
    return {
      plans: [], visits: [], devices: [], sightings: [], applications: [],
      billing: generateBilling(account, [], [], makeRandom(seed + account.index * 104729), false),
    };
  }

  const technicianCount = dataset.technicians.length;
  const productCount = dataset.products.length;
  const propertyCount = account.properties.length;
  const technicianFor = (offset: number) => (account.index * 3 + offset) % technicianCount;

  const plans: SeedPlan[] = Array.from({ length: between(random, 1, 3) }, (_, seat) => ({
    propertyIndex: seat % propertyCount,
    serviceType: SERVICE_TYPES[(account.index + seat) % SERVICE_TYPES.length],
    recurrence: RECURRENCES[(account.index + seat) % RECURRENCES.length],
    // Some plans are due or overdue so the dispatch lane has real work.
    dueInDays: between(random, -14, 60),
    technicianIndex: technicianFor(seat),
    valueCents: between(random, 45, 620) * 1000,
    notes: `${pick(random, ["Service before opening", "Coordinate with the night crew", "Notify the front desk on arrival", "Access through the service corridor"])}.`,
    active: seat === 0 || chance(random, 0.7),
  }));

  const visits: SeedVisit[] = Array.from({ length: between(random, 2, 6) }, (_, seat) => {
    const past = seat % 3 !== 0;
    const outcome = (account.index + seat) % 6;
    const statusPath =
      !past ? ([] as const)
      : outcome === 0 ? (["dispatched"] as const)
      : outcome === 1 ? (["dispatched", "in_progress"] as const)
      : outcome === 5 ? (["cancelled"] as const)
      : (["dispatched", "completed"] as const);
    // Most visits are generated from a plan; some are one-off callbacks,
    // which is exactly the mix a real schedule carries.
    const planIndex = seat % 4 === 3 ? undefined : seat % plans.length;
    return {
      propertyIndex: planIndex === undefined ? seat % propertyCount : plans[planIndex].propertyIndex,
      serviceType:
        planIndex === undefined
          ? SERVICE_TYPES[(account.index + seat * 2) % SERVICE_TYPES.length]
          : plans[planIndex].serviceType,
      inDays: past ? -between(random, 1, 720) : between(random, 1, 45),
      durationHours: between(random, 1, 6),
      technicianIndex: technicianFor(seat + 1),
      statusPath,
      ...(planIndex === undefined ? {} : { planIndex }),
      instructions: `${pick(random, ["Check the dock doors first", "Bring the ladder for the ILT", "Rebait the north line", "Photograph any conducive conditions", "Collect the monitor counts"])}.`,
      completionNotes: `Service complete. ${pick(random, ["All stations serviced and rebaited", "Monitors read and replaced", "Interior and exterior treated", "Exclusion points sealed", "No activity found this visit"])}; ${pick(random, ["no follow-up needed", "follow-up scheduled", "sanitation noted for the customer", "recommended a repair to the door sweep"])}.`,
    };
  });

  // Which visits actually happened — a scan can only belong to one of those.
  const completedVisitPositions = visits
    .map((visit, position) => ({ visit, position }))
    .filter((entry) => entry.visit.statusPath.includes("completed"))
    .map((entry) => entry.position);

  const devices: SeedDevice[] = Array.from({ length: between(random, 2, 8) }, (_, seat) => {
    const installedDaysAgo = between(random, 40, 800);
    const scanCount = between(random, 1, 4);
    let cursor = installedDaysAgo;
    const scans = Array.from({ length: scanCount }, (_, scanSeat) => {
      // Scans strictly postdate the install and each other.
      cursor = Math.max(1, cursor - between(random, 5, 90));
      const isLast = scanSeat === scanCount - 1;
      const event = isLast && (account.index + seat) % 9 === 0 ? "remove"
        : isLast && (account.index + seat) % 7 === 0 ? "move"
        : "service";
      return {
        event: event as "service" | "move" | "remove",
        daysAgo: cursor,
        condition: pick(random, DEVICE_CONDITIONS),
        activityCount: between(random, 0, 14),
        pestObserved: pick(random, PESTS),
        locationNote: pick(random, LOCATION_NOTES),
        note: `${pick(random, ["Rebaited", "Cleaned and reset", "Bait consumed, replaced", "Trap cleared", "Housing checked"])}; ${pick(random, ["runway confirmed", "no further activity", "harborage noted nearby", "customer informed"])}.`,
        // A service scan taken on a route visit names it; an ad-hoc check
        // does not, which is how a real ledger reads.
        ...(event === "service" && completedVisitPositions.length > 0 && scanSeat % 2 === 0
          ? { visitIndex: completedVisitPositions[(seat + scanSeat) % completedVisitPositions.length] }
          : {}),
      };
    });
    return {
      propertyIndex: seat % propertyCount,
      label: `Station ${pad(seat + 1, 2)}`,
      deviceType: DEVICE_TYPES[(account.index + seat) % DEVICE_TYPES.length],
      // Unique across the whole book by construction.
      barcode: `DEMO-ST-${pad(account.index, 4)}-${pad(seat, 2)}`,
      installedDaysAgo,
      locationNote: pick(random, LOCATION_NOTES),
      activityThreshold: between(random, 2, 12),
      scans,
    };
  });

  const sightings: SeedSighting[] = Array.from({ length: between(random, 1, 4) }, (_, seat) => {
    const daysAgo = between(random, 2, 500);
    const resolved = (account.index + seat) % 3 !== 0;
    return {
      propertyIndex: seat % propertyCount,
      pest: PESTS[(account.index + seat) % PESTS.length],
      severity: pick(random, ["low", "moderate", "high"] as const),
      daysAgo,
      locationNote: pick(random, LOCATION_NOTES),
      note: `Reported by ${pick(random, ["the customer", "the route technician", "the night manager", "an auditor"])}; ${pick(random, ["photographed", "monitors placed", "harborage identified", "conducive condition noted"])}.`,
      ...(resolved
        ? {
            correctiveAction: `${pick(random, ["Exclusion completed at the entry point", "Sanitation corrected with the customer", "Monitors added and thresholds set", "Treatment applied and verified", "Door sweep replaced"])}; ${pick(random, ["verified clear on the follow-up", "no activity on the next two visits", "customer signed off", "trend returned to baseline"])}.`,
            correctedDaysAgo: Math.max(1, daysAgo - between(random, 1, 30)),
          }
        : {}),
    };
  });

  // Only a completed visit can carry an application: a technician cannot
  // have applied a product on a call that never happened.
  const completedVisits = completedVisitPositions;

  const applications: SeedApplication[] = Array.from({ length: between(random, 2, 6) }, (_, seat) => {
    const productIndex = (account.index * 5 + seat) % productCount;
    const product = dataset.products[productIndex];
    return {
      propertyIndex: seat % propertyCount,
      productIndex,
      lotIndex: seat % product.lots.length,
      technicianIndex: technicianFor(seat + 2),
      // Some applications name the station they treated…
      ...(devices.length > 0 && seat % 2 === 0 ? { deviceIndex: seat % devices.length } : {}),
      // …and most name the completed visit they were performed on.
      ...(completedVisits.length > 0 && seat % 3 !== 2
        ? { visitIndex: completedVisits[seat % completedVisits.length] }
        : {}),
      // Every fourth account carries one correction, so the supersede path
      // is exercised by real data rather than only by its unit test.
      ...(seat === 1 && account.index % 4 === 0 ? { supersedesIndex: 0 } : {}),
      method: APPLICATION_METHODS[(account.index + seat) % APPLICATION_METHODS.length],
      // Small enough that many applications can draw one lot without exhausting it.
      quantity: Number((between(random, 1, 20) / 10).toFixed(3)),
      daysAgo: between(random, 1, 700),
      targetPest: PESTS[(account.index + seat * 2) % PESTS.length],
      applicationRate: pick(random, APPLICATION_RATES),
      treatedArea: pick(random, TREATED_AREAS),
      locationNote: pick(random, LOCATION_NOTES),
      note: `Applied per label; ${pick(random, ["customer notified", "area vacated during application", "ventilated after treatment", "re-entry interval observed"])}.`,
    };
  });

  return {
    plans,
    visits,
    devices,
    sightings,
    applications,
    billing: generateBilling(account, plans, visits, makeRandom(seed + account.index * 104729), true),
  };
}

const LINE_DESCRIPTIONS = [
  "Initial service and inspection", "Monthly IPM service", "Quarterly deep inspection",
  "Rodent exclusion labour", "Exclusion materials", "Bait station installation",
  "Bed bug heat treatment", "Termite inspection", "Emergency callback",
  "Monitoring devices", "Sanitation consultation", "Wildlife exclusion",
] as const;
const VOID_REASONS = [
  "Raised against the wrong site.", "Duplicate of an earlier invoice.",
  "Superseded by the corrected contract total.", "Billed before the work was authorised.",
] as const;
const REFUND_REASONS = [
  "Partial credit for a missed visit.", "Overcharged on the materials line.",
  "Goodwill credit after a rescheduled appointment.", "Service cancelled mid-term.",
] as const;

/**
 * The paper trail for one account: estimates that were quoted, the contract
 * an accepted one became, and the invoices raised against it — some paid,
 * some open, some overdue, one void, and a few carrying refunds. The point
 * is the spread: a billing page tested only against paid invoices is not
 * tested.
 */
function generateBilling(
  account: SeedAccount,
  plans: SeedPlan[],
  visits: SeedVisit[],
  random: Random,
  serviced: boolean,
): SeedBilling {
  const propertyCount = Math.max(1, account.properties.length);
  const completedVisits = visits
    .map((visit, position) => ({ visit, position }))
    .filter((entry) => entry.visit.statusPath.includes("completed"))
    .map((entry) => entry.position);

  const estimateCount = between(random, 1, 3);
  const estimates = Array.from({ length: estimateCount }, (_, seat) => {
    /*
     * An account became a customer by accepting something, so a serviced
     * account's first estimate is always accepted; the rest spread across
     * the other outcomes. A book where nobody ever said yes would have no
     * contracts to test against.
     */
    const outcome = (account.index + seat) % 5;
    const status =
      seat === 0 && serviced ? "accepted"
      : outcome === 0 ? "draft"
      : outcome === 1 ? "sent"
      : outcome === 2 ? "declined"
      : outcome === 3 ? "expired"
      : "accepted";
    const lineCount = between(random, 1, 4);
    const lines = Array.from({ length: lineCount }, (_, line) => ({
      description: LINE_DESCRIPTIONS[(account.index + seat + line) % LINE_DESCRIPTIONS.length],
      quantity: between(random, 1, 12),
      unitPriceCents: between(random, 45, 900) * 100,
    }));
    const sentDaysAgo = between(random, 20, 800);
    return {
      number: `EST-${pad(account.index, 4)}-${pad(seat + 1, 2)}`,
      status: status as SeedBilling["estimates"][number]["status"],
      lines,
      taxCents: Math.round(
        lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) * 0.08,
      ),
      validInDays: between(random, -200, 60),
      terms: `${pick(random, ["Net 30", "Net 15", "Due on receipt", "Net 45"])}. ${pick(random, ["Service begins on signature.", "Materials included.", "Annual term, cancellable with 30 days' notice.", "Price held for 60 days."])}`,
      notes: `Quoted after the ${pick(random, ["site walk", "inspection", "phone intake", "renewal review"])}.`,
      sentDaysAgo,
      ...(status === "draft" || status === "sent"
        ? {}
        : { decidedDaysAgo: Math.max(1, sentDaysAgo - between(random, 1, 19)) }),
      propertyIndex: seat % propertyCount,
      ...(account.opportunities.length > 0 ? { opportunityIndex: seat % account.opportunities.length } : {}),
    };
  });

  const acceptedIndex = estimates.findIndex((estimate) => estimate.status === "accepted");
  /*
   * A renewed annual agreement leaves two rows behind: the prior term,
   * closed on the day the new one started, and the current term that
   * replaced it. Roughly a third of the book has been with us long enough
   * to have renewed at least once — without that, a renewals report and a
   * contract history panel have nothing to read.
   */
  const renewed = acceptedIndex !== -1 && account.index % 3 === 0;
  const signatory = `${account.contacts[0]?.firstName ?? "Alex"} ${account.contacts[0]?.lastName ?? "Reyes"}`;
  const currentStartsInDays = -between(random, 30, 700);
  const currentValueCents =
    acceptedIndex === -1
      ? 0
      : estimates[acceptedIndex].lines.reduce(
          (sum, line) => sum + line.quantity * line.unitPriceCents,
          0,
        ) + estimates[acceptedIndex].taxCents;
  const contracts =
    acceptedIndex === -1
      ? []
      : [
          {
            // The current term keeps index 0 so the newest paper is first.
            number: `CON-${pad(account.index, 4)}-${renewed ? "02" : "01"}`,
            status: (account.index % 9 === 0
              ? "ended"
              : account.index % 13 === 0
                ? "cancelled"
                : "active") as SeedBilling["contracts"][number]["status"],
            estimateIndex: acceptedIndex,
            ...(plans.length > 0 ? { planIndex: 0 } : {}),
            valueCents: currentValueCents,
            startsInDays: currentStartsInDays,
            endsInDays: between(random, 30, 400),
            autoRenew: account.index % 3 !== 0,
            terms: "Annual agreement; service per the accepted estimate.",
            notes: `Signed ${pick(random, ["at the site", "by email", "at the branch office", "on the customer portal"])}.`,
            signedDaysAgo: between(random, 30, 700),
            signedByName: signatory,
            ...(account.index % 9 === 0 || account.index % 13 === 0
              ? { endedDaysAgo: between(random, 1, 29) }
              : {}),
          },
          ...(renewed
            ? [
                {
                  number: `CON-${pad(account.index, 4)}-01`,
                  status: "ended" as SeedBilling["contracts"][number]["status"],
                  // The prior term was quoted before the paper we still
                  // hold, so it names no estimate — which is also the only
                  // thing in the book exercising the nullable estimate.
                  ...(plans.length > 0 ? { planIndex: 0 } : {}),
                  valueCents: Math.round(currentValueCents * 0.92),
                  startsInDays: currentStartsInDays - 365,
                  // It ended the day the renewal took over.
                  endsInDays: currentStartsInDays,
                  autoRenew: true,
                  terms: "Annual agreement; renewed on its anniversary.",
                  notes: "Prior term; superseded by the renewal on the same site.",
                  signedDaysAgo: -currentStartsInDays + 365,
                  signedByName: signatory,
                  endedDaysAgo: -currentStartsInDays,
                },
              ]
            : []),
        ];

  const invoiceCount = between(random, 2, 5);
  const invoices = Array.from({ length: invoiceCount }, (_, seat) => {
    const lineCount = between(random, 1, 3);
    const lines = Array.from({ length: lineCount }, (_, line) => ({
      description: LINE_DESCRIPTIONS[(account.index + seat * 2 + line) % LINE_DESCRIPTIONS.length],
      quantity: between(random, 1, 6),
      unitPriceCents: between(random, 45, 620) * 100,
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
    const tax = Math.round(subtotal * 0.08);
    const total = subtotal + tax;
    const issuedDaysAgo = between(random, 5, 700);

    // The spread: mostly settled, some part-paid, some untouched and
    // overdue, an occasional void, and a rare write-off.
    const outcome = (account.index + seat) % 8;
    const status =
      outcome === 6 ? "void"
      : outcome === 7 ? "uncollectible"
      : outcome === 5 ? "draft"
      : "open";
    const payments =
      status === "void" || status === "draft"
        ? []
        : outcome === 0 || outcome === 1 || outcome === 2
          ? [
              {
                amountCents: total,
                method: pick(random, ["card", "ach", "check", "cash", "other"] as const),
                reference: `DEMO-PAY-${pad(account.index, 4)}-${pad(seat, 2)}`,
                daysAgo: Math.max(1, issuedDaysAgo - between(random, 1, 20)),
                note: `Settled in full by ${pick(random, ["the office", "the customer portal", "the branch", "autopay"])}.`,
                /*
                 * A settled invoice can still be credited afterwards — a
                 * missed visit, an overcharged materials line. Two of the
                 * eight outcomes carry one, at different sizes, so a
                 * credits report reads a spread rather than one figure.
                 */
                ...(outcome === 1 || outcome === 2
                  ? {
                      refund: {
                        amountCents: Math.max(
                          100,
                          Math.round(total * (outcome === 2 ? 0.25 : 0.15)),
                        ),
                        reason: pick(random, REFUND_REASONS),
                        daysAgo: Math.max(1, issuedDaysAgo - between(random, 21, 40)),
                      },
                    }
                  : {}),
              },
            ]
          : outcome === 3
            ? [
                {
                  amountCents: Math.max(100, Math.round(total / 2)),
                  method: pick(random, ["card", "ach", "check"] as const),
                  reference: `DEMO-PAY-${pad(account.index, 4)}-${pad(seat, 2)}`,
                  daysAgo: Math.max(1, issuedDaysAgo - between(random, 1, 15)),
                  note: "Part payment; balance agreed for the following month.",
                  // The balance was renegotiated down rather than chased.
                  refund: {
                    amountCents: Math.max(100, Math.round(total * 0.1)),
                    reason: "Partial credit agreed while the balance was renegotiated.",
                    daysAgo: Math.max(1, issuedDaysAgo - between(random, 16, 30)),
                  },
                },
              ]
            : [];
    return {
      number: `INV-${pad(account.index, 4)}-${pad(seat + 1, 2)}`,
      status: status as SeedBilling["invoices"][number]["status"],
      // Older invoices sit on the prior term where one exists.
      ...(contracts.length > 0 ? { contractIndex: seat % contracts.length } : {}),
      ...(completedVisits.length > 0 && seat % 2 === 0
        ? { visitIndex: completedVisits[seat % completedVisits.length] }
        : {}),
      lines,
      taxCents: tax,
      issuedDaysAgo,
      netDays: pick(random, [0, 15, 30, 45]),
      memo: `${pick(random, ["Service for the period stated", "Per the signed agreement", "Callback visit", "Materials and labour"])}.`,
      ...(status === "void" ? { voidReason: pick(random, VOID_REASONS) } : {}),
      payments,
    };
  });

  /*
   * Commissions. A won deal earns one at the owner's own rate; a fully
   * settled invoice earns one on collection, which is how most of these
   * businesses actually pay — something sold is not something banked. An
   * account nobody owns earns nobody anything, and that is left true rather
   * than papered over with a house rate.
   */
  const rateBps = account.ownerCommissionBps;
  const commissions: SeedBilling["commissions"] =
    rateBps === undefined
      ? []
      : [
          ...account.opportunities.flatMap((opportunity, seat) =>
            opportunity.stagePath[opportunity.stagePath.length - 1] === "won"
              ? [
                  {
                    opportunityIndex: seat,
                    basisCents: opportunity.valueCents,
                    rateBps,
                    status: (["accrued", "approved", "paid", "paid", "void"] as const)[
                      (account.index + seat) % 5
                    ],
                    earnedDaysAgo: between(random, 20, 700),
                    note: `Earned on the signed ${pick(random, ["annual agreement", "initial service", "commercial contract", "renewal"])}.`,
                  },
                ]
              : [],
          ),
          ...invoices.flatMap((invoice, seat) =>
            // Collected in full, and only every other one — a commission on
            // every invoice would make the ledger read like a bonus scheme.
            invoice.status === "open"
            && invoice.payments.length === 1
            && invoice.payments[0].amountCents
              >= invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0)
                + invoice.taxCents
            && seat % 2 === 0
              ? [
                  {
                    invoiceIndex: seat,
                    ...(contracts.length > 0 ? { contractIndex: seat % contracts.length } : {}),
                    basisCents:
                      invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
                    rateBps: Math.round(rateBps / 2),
                    status: (["accrued", "approved", "paid"] as const)[(account.index + seat) % 3],
                    earnedDaysAgo: Math.max(1, invoice.issuedDaysAgo - between(random, 1, 15)),
                    note: "Earned on collection, at half the new-business rate.",
                  },
                ]
              : [],
          ),
        ];

  return { estimates, contracts, invoices, commissions };
}

/** Everything the seeder needs to label a row as demonstration data. */
export const SEED_SOURCE = DEMO_SOURCE;

export { daysAgoIso, dateInDays };

/* ----------------------------------------------- the company: increment 7 */

const BRANCH_SUFFIXES = [
  "Branch", "Service Center", "Depot", "Operations", "Field Office", "Yard",
] as const;
const ZONE_BY_REGION: Record<string, string> = {
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  ID: "America/Boise",
};
const EMPLOYEE_TITLES: Record<SeedEmployee["role"], string> = {
  owner: "Owner",
  branch_manager: "Branch Manager",
  sales_manager: "Sales Manager",
  sales_rep: "Sales Representative",
  csr: "Customer Service Representative",
  dispatcher: "Dispatcher",
  admin: "Office Administrator",
};
const TERRITORY_DIRECTIONS = [
  "North", "South", "East", "West", "Central", "Ridge", "Valley", "Coast",
] as const;

/**
 * A branch is a real place: a city, a phone, a time zone that decides what
 * "8am" means on its route sheet. Every seventeenth one has closed — a book
 * that has never lost an office is not a book anyone has run for long.
 */
function generateBranch(random: Random, index: number): SeedBranch {
  const [city, region, zip] = CITIES[index % CITIES.length];
  const suffix = BRANCH_SUFFIXES[index % BRANCH_SUFFIXES.length];
  const closed = index % 17 === 0 && index !== 0;
  const openedDaysAgo = between(random, 400, 5200);
  return {
    code: `BR-${pad(index, 4)}`,
    name: `${city} ${suffix} ${pad(index, 3)}`,
    address: `${between(random, 100, 9800)} ${pick(random, STREETS)}, ${city}, ${region} ${zip}`,
    phone: phoneFor(40_000 + index),
    email: `branch${pad(index, 4)}@demo-pest-services.example`,
    timeZone: ZONE_BY_REGION[region] ?? "America/Los_Angeles",
    openedDaysAgo,
    ...(closed ? { closedDaysAgo: Math.max(1, openedDaysAgo - between(random, 100, 380)) } : {}),
    active: !closed,
    notes: `${pick(random, ["Two bays and a chemical store", "Shares a yard with the fleet", "Leased through the term", "Owned outright"])}.`,
  };
}

/**
 * The org chart. Index 0 is the owner and reports to nobody; everyone else
 * reports to someone earlier in the list, so the graph is acyclic by
 * construction rather than by luck. Roles repeat on a fixed cycle so every
 * one of the seven is represented however small the scale.
 */
function generateEmployee(random: Random, index: number, branchCount: number): SeedEmployee {
  const roles: SeedEmployee["role"][] = [
    "branch_manager", "sales_rep", "sales_rep", "csr", "sales_rep",
    "dispatcher", "sales_manager", "sales_rep", "admin", "csr",
  ];
  const role: SeedEmployee["role"] = index === 0 ? "owner" : roles[index % roles.length];
  const firstName = GIVEN_NAMES[(index * 5) % GIVEN_NAMES.length];
  const lastName = FAMILY_NAMES[(index * 7) % FAMILY_NAMES.length];
  const selling = role === "sales_rep" || role === "sales_manager" || role === "branch_manager" || role === "owner";
  const hiredDaysAgo = between(random, 60, 4200);
  // A minority have moved on; their commissions and signatures stay.
  const ended = index % 23 === 0 && index !== 0;
  return {
    employeeCode: `EMP-${pad(index, 5)}`,
    firstName,
    lastName,
    email: `${slug(firstName)}.${slug(lastName)}${index}@demo-pest-services.example`,
    phone: phoneFor(50_000 + index),
    role,
    title: EMPLOYEE_TITLES[role],
    ...(branchCount > 0 && index !== 0 ? { branchIndex: index % branchCount } : {}),
    // Everyone but the owner reports to somebody already in the list.
    ...(index === 0 ? {} : { reportsToIndex: Math.floor(index / 4) === index ? 0 : Math.floor(index / 4) }),
    hiredDaysAgo,
    ...(ended ? { endedDaysAgo: Math.max(1, hiredDaysAgo - between(random, 30, 900)) } : {}),
    active: !ended,
    ...(selling ? { commissionBps: [500, 650, 750, 850, 1000][index % 5] } : {}),
    ...(role === "sales_rep" || role === "sales_manager"
      ? { monthlyQuotaCents: between(random, 15, 90) * 100_000 }
      : {}),
    notes: `${pick(random, ["Covers the north side", "Runs the commercial book", "Handles renewals", "Backs up dispatch", "Trains new hires"])}.`,
  };
}

/**
 * A territory is a branch's slice of the map, worked by one rep, defined by
 * the postal codes it covers. The codes are derived from the branch's own
 * city so a territory never spans two states by accident.
 */
function generateTerritory(
  random: Random,
  index: number,
  branchCount: number,
  salesRepIndices: number[],
): SeedTerritory {
  const branchIndex = index % Math.max(1, branchCount);
  const [city, region, zip] = CITIES[branchIndex % CITIES.length];
  const base = Number.parseInt(zip, 10);
  const span = between(random, 2, 8);
  return {
    code: `TR-${pad(index, 4)}`,
    name: `${city} ${TERRITORY_DIRECTIONS[index % TERRITORY_DIRECTIONS.length]} ${pad(index, 3)}`,
    branchIndex,
    // A tenth of the map is unworked, which is the number a sales manager
    // opens this page to find.
    ...(salesRepIndices.length > 0 && index % 10 !== 0
      ? { repIndex: salesRepIndices[index % salesRepIndices.length] }
      : {}),
    city,
    region,
    postalCodes: Array.from({ length: span }, (_, step) => pad(base + step * 3, 5)),
    active: index % 14 !== 0,
    notes: `${pick(random, ["Dense residential", "Mixed commercial and residential", "Rural route, long drives", "Downtown core"])}.`,
  };
}

/* --------------------------------- documents, canvassing and marketing (8) */

const DOCUMENT_KINDS = [
  "contract", "estimate", "photo", "inspection_report", "service_report",
  "permit", "license", "invoice", "other",
] as const;
const DOCUMENT_TITLES: Record<(typeof DOCUMENT_KINDS)[number], string> = {
  contract: "Signed annual agreement",
  estimate: "Quoted proposal",
  photo: "Site photo — dock doors",
  inspection_report: "Quarterly IPM inspection",
  service_report: "Service visit summary",
  permit: "Municipal treatment permit",
  license: "Applicator licence on file",
  invoice: "Invoice copy",
  other: "Correspondence",
};
const CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "text/csv"] as const;

/** The disposition vocabulary, as a type — the values are chosen by roll below. */
type KnockDisposition = SeedCanvassRoute["knocks"][number]["disposition"];
const KNOCK_NOTES = [
  "Left a door hanger", "Spoke with the homeowner", "Dog in the yard, came back later",
  "Neighbour said they use someone already", "Asked us to call after six",
  "Wants a quote for the crawl space", "Renting — landlord decides",
] as const;

const LIST_THEMES = [
  "Quarterly renewals", "Lapsed customers", "Commercial kitchens", "New movers",
  "Termite warranty holders", "Rodent season reminder", "Mosquito program",
  "Bed bug follow-up", "Annual inspection due", "Referral advocates",
] as const;
const CAMPAIGN_THEMES = [
  "Spring rodent sweep", "Summer mosquito program", "Termite inspection reminder",
  "Winter exclusion offer", "Quarterly service renewal", "Referral thank-you",
  "Commercial audit season", "Bed bug awareness",
] as const;
const AUTOMATION_TRIGGERS = [
  "lead_created", "service_completed", "invoice_overdue",
  "contract_renewing", "sighting_recorded", "estimate_sent",
] as const;
const AUTOMATION_ACTIONS = [
  "send_email", "send_sms", "create_task", "notify_manager", "schedule_followup",
] as const;

/**
 * A day of doors. Roughly a third of a route's knocks land on somebody, and
 * only a handful sell — which is what a canvassing report should look like.
 * A door that sold names the customer it produced, because the schema will
 * not hold one that does not.
 */
function generateCanvassRoute(
  random: Random,
  index: number,
  territoryCount: number,
  salesRepIndices: number[],
  accountCount: number,
): SeedCanvassRoute {
  const [city, region] = CITIES[index % CITIES.length];
  const status = (
    index % 11 === 0 ? "cancelled"
    : index % 7 === 0 ? "planned"
    : index % 5 === 0 ? "walking"
    : "complete"
  ) as SeedCanvassRoute["status"];
  const knockCount = status === "planned" || status === "cancelled" ? 0 : between(random, 8, 26);
  let cursor = 0;
  return {
    name: `${city} ${region} door route ${pad(index, 4)}`,
    ...(territoryCount > 0 ? { territoryIndex: index % territoryCount } : {}),
    ...(salesRepIndices.length > 0
      ? { repIndex: salesRepIndices[index % salesRepIndices.length] }
      : {}),
    status,
    walkedDaysAgo: between(random, 1, 900),
    notes: `${pick(random, ["Two blocks either side of the arterial", "Apartment complex, front desk first", "New build subdivision", "Older housing stock, heavy rodent pressure"])}.`,
    knocks: Array.from({ length: knockCount }, (_, seat) => {
      cursor += between(random, 3, 14);
      const roll = (index + seat) % 12;
      const disposition = (
        roll === 0 ? "sold"
        : roll === 1 ? "appointment_set"
        : roll === 2 ? "callback"
        : roll === 3 ? "do_not_knock"
        : roll <= 6 ? "not_interested"
        : roll <= 9 ? "no_answer"
        : "not_home"
      ) as KnockDisposition;
      return {
        address: `${between(random, 100, 9800)} ${pick(random, STREETS)}, ${city}, ${region}`,
        disposition,
        minutesIn: cursor,
        // Only a sale names an account, exactly as the CHECK requires.
        ...(disposition === "sold" && accountCount > 0
          ? { accountIndex: (index * 7 + seat) % accountCount }
          : {}),
        ...(disposition === "callback" || disposition === "appointment_set"
          ? { followUpInDays: between(random, 1, 21) }
          : {}),
        note: `${pick(random, KNOCK_NOTES)}.`,
      };
    }),
  };
}

function generateMarketingList(random: Random, index: number): SeedMarketingList {
  const theme = LIST_THEMES[index % LIST_THEMES.length];
  const dynamic = index % 3 === 0;
  return {
    name: `${theme} ${pad(index, 4)}`,
    description: `${pick(random, ["Built for the seasonal push", "Maintained by the office", "Kept for the renewal cycle", "Used by the commercial team"])}.`,
    isDynamic: dynamic,
    // A dynamic list says what it selects; a static one carries nothing.
    ...(dynamic
      ? { criteria: pick(random, [
          "status = customer and last service older than 180 days",
          "kind = commercial and territory in the north branch",
          "contract ends within 60 days",
          "sighting recorded in the last 90 days",
        ]) }
      : {}),
    active: index % 13 !== 0,
  };
}

function generateCampaign(random: Random, index: number, listCount: number): SeedCampaign {
  const theme = CAMPAIGN_THEMES[index % CAMPAIGN_THEMES.length];
  const channel = (["email", "email", "sms", "postcard"] as const)[index % 4];
  const roll = index % 7;
  const status = (
    roll === 0 ? "draft"
    : roll === 1 ? "scheduled"
    : roll === 2 ? "cancelled"
    : roll === 3 ? "sending"
    : "sent"
  ) as SeedCampaign["status"];
  const sentDaysAgo = between(random, 5, 800);
  return {
    name: `${theme} ${pad(index, 4)}`,
    ...(listCount > 0 ? { listIndex: index % listCount } : {}),
    channel,
    status,
    // The schema refuses an email campaign with no subject.
    ...(channel === "email" ? { subject: `${theme} — book your visit` } : {}),
    body: `${theme}. ${pick(random, ["Reply STOP to opt out.", "Call the branch to book.", "Reply to schedule a free inspection.", "Your technician can add this on the next visit."])}`,
    budgetCents: between(random, 5, 400) * 10_000,
    ...(status === "scheduled" ? { scheduledDaysAgo: -between(random, 1, 45) } : {}),
    ...(status === "sent" || status === "sending" ? { sentDaysAgo } : {}),
    recipientStride: 3 + (index % 9),
    recipientCount: status === "draft" || status === "cancelled" ? 0 : between(random, 10, 60),
  };
}

function generateAutomation(random: Random, index: number): SeedAutomation {
  const action = AUTOMATION_ACTIONS[index % AUTOMATION_ACTIONS.length];
  const sending = action === "send_email" || action === "send_sms";
  return {
    name: `${pick(random, ["Follow up on", "Remind about", "Escalate", "Chase", "Thank after"])} ${AUTOMATION_TRIGGERS[index % AUTOMATION_TRIGGERS.length].replace(/_/g, " ")} ${pad(index, 4)}`,
    triggerOn: AUTOMATION_TRIGGERS[index % AUTOMATION_TRIGGERS.length],
    action,
    delayHours: [0, 1, 4, 24, 48, 72, 168][index % 7],
    // A rule that sends something carries the text it would send.
    ...(sending
      ? { template: `${pick(random, ["Hi {{first_name}}, ", "Hello from the branch — ", "Quick note: "])}${pick(random, ["your next service is due.", "we noticed activity at your site.", "your agreement renews soon.", "thanks for having us out."])}` }
      : {}),
    // Armed rules are the minority, and nothing executes them yet in any case.
    active: index % 4 === 0,
  };
}

/* ---------------------------------------- forms, timesheets, licences (9) */

const FORM_KINDS = [
  "inspection", "service_report", "compliance_checklist", "wdo_report",
  "safety_check", "other",
] as const;
const FORM_SUBJECTS = [
  "Quarterly IPM inspection", "Rodent station audit", "Kitchen sanitation review",
  "Termite graph and findings", "Bed bug follow-up", "Exterior perimeter check",
  "Loading dock survey", "Safety walk", "Pre-treatment checklist",
  "Post-service verification",
] as const;

/**
 * A form template's questions, chosen so every field type appears somewhere
 * in the corpus and every completed form has something real to say. The two
 * choice types carry their choices, because the schema pairs them.
 */
function formQuestions(index: number): SeedFormTemplate["fields"] {
  const base: SeedFormTemplate["fields"] = [
    {
      label: "Areas inspected",
      fieldType: "long_text",
      required: true,
      helpText: "Everything walked on this visit.",
    },
    {
      label: "Stations serviced",
      fieldType: "number",
      required: true,
      helpText: "Count of devices checked.",
    },
    {
      label: "Activity found",
      fieldType: "boolean",
      required: true,
      helpText: "Any evidence at all.",
    },
    {
      label: "Severity",
      fieldType: "select",
      required: false,
      helpText: "Where the site sits today.",
      options: ["none", "low", "moderate", "high"],
    },
    {
      label: "Pests observed",
      fieldType: "multi_select",
      required: false,
      helpText: "All that apply.",
      options: ["ants", "german roaches", "norway rats", "house mice", "bed bugs", "wasps"],
    },
    {
      label: "Next visit due",
      fieldType: "date",
      required: false,
      helpText: "When this site should be seen again.",
    },
    {
      label: "Customer contact spoken to",
      fieldType: "text",
      required: false,
      helpText: "Who signed off on site.",
    },
  ];
  // A little variation so the corpus is not 260 identical forms.
  return index % 3 === 0 ? base : base.slice(0, 5 + (index % 3));
}

function generateFormTemplate(random: Random, index: number): SeedFormTemplate {
  const subject = FORM_SUBJECTS[index % FORM_SUBJECTS.length];
  return {
    name: `${subject} ${pad(index, 4)}`,
    kind: FORM_KINDS[index % FORM_KINDS.length],
    // A handful are on their second version, because a real book revises.
    version: index % 17 === 0 ? 2 : 1,
    description: `${pick(random, ["Used on every quarterly visit", "Required by the account's compliance rule", "Filled out at the end of service", "Completed before treatment begins"])}.`,
    active: index % 19 !== 0,
    fields: formQuestions(index),
  };
}

/**
 * Shifts for one technician, laid end to end so they never overlap — the
 * database refuses an overlap, and a seeder that produced one would be
 * testing the guard rather than the book.
 */
function generateShifts(
  random: Random,
  technicianIndex: number,
  count: number,
): NonNullable<SeedTechnician["shifts"]> {
  return Array.from({ length: count }, (_, seat) => {
    // One shift per day, so two shifts can never share an hour.
    const startedDaysAgo = 1 + seat * 3 + (technicianIndex % 3);
    const open = seat === 0 && technicianIndex % 8 === 0;
    return {
      startedDaysAgo,
      startHour: 7 + (seat % 3),
      hours: between(random, 4, 9),
      breakMinutes: [0, 30, 45, 60][seat % 4],
      open,
      notes: `${pick(random, ["Route day", "Callback run", "Commercial audits", "Training in the morning", "Covering the north side"])}.`,
    };
  });
}
