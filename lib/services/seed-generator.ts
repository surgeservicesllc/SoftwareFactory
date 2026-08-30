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
export const SEED_TARGETS: Record<SeedScale, { accounts: number; technicians: number; products: number; jurisdictions: number }> = {
  demo: { accounts: 40, technicians: 12, products: 14, jurisdictions: 8 },
  full: { accounts: 320, technicians: 260, products: 260, jurisdictions: 260 },
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
};

export type SeedTechnician = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  active: boolean;
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

export type SeedDataset = {
  scale: SeedScale;
  accounts: SeedAccount[];
  technicians: SeedTechnician[];
  products: SeedProduct[];
  jurisdictions: SeedJurisdiction[];
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
  return {
    scale,
    accounts: Array.from({ length: targets.accounts }, (_, index) => generateAccount(random, index)),
    technicians: Array.from({ length: targets.technicians }, (_, index) => generateTechnician(random, index)),
    products: Array.from({ length: targets.products }, (_, index) => generateProduct(random, index)),
    jurisdictions: Array.from({ length: targets.jurisdictions }, (_, index) => generateJurisdiction(random, index)),
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

export type SeedOperations = {
  plans: SeedPlan[];
  visits: SeedVisit[];
  devices: SeedDevice[];
  sightings: SeedSighting[];
  applications: SeedApplication[];
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
  if (!serviced) return { plans: [], visits: [], devices: [], sightings: [], applications: [] };

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

  return { plans, visits, devices, sightings, applications };
}

/** Everything the seeder needs to label a row as demonstration data. */
export const SEED_SOURCE = DEMO_SOURCE;

export { daysAgoIso, dateInDays };
