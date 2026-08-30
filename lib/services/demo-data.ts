/**
 * The Demo Data book of business (owner directive, task #63): a rich,
 * deterministic, clearly-fictional pest-services clientele a workspace can
 * seed itself with to present the CRM — residential and commercial,
 * multi-property sites, deals across every pipeline stage, and months of
 * hand-recorded history.
 *
 * Honesty rules, enforced by tests:
 *   - every seeded account carries the exact source label "Demo Data";
 *   - every email is on a reserved `.example` domain, every phone in the
 *     fictional 555 range — no seeded string can reach a real person;
 *   - every field respects the schema's own CHECK bounds, proved by
 *     replaying this dataset against the real migration chain.
 *
 * The seeder walks statuses and stages one move at a time so the database
 * triggers write the history — seeded records earn their timeline the same
 * way live ones do, through the machinery, never by forging system rows.
 */

export const DEMO_SOURCE = "Demo Data";

export type DemoEvent = {
  kind: "note" | "call" | "email" | "sms" | "task";
  summary: string;
  detail?: string;
  daysAgo: number;
};

export type DemoOpportunity = {
  name: string;
  valueCents: number;
  /** Stages after the initial `new`, walked in order so triggers record each move. */
  stagePath: readonly ("contacted" | "inspection" | "proposal" | "negotiation" | "won" | "lost")[];
  expectedInDays?: number;
  lostReason?: string;
};

export type DemoTechnician = {
  firstName: string;
  lastName: string;
  phone: string;
  licenseNumber: string;
};

/** The roster the demo visits are assigned to, referenced by index. */
export const DEMO_TECHNICIANS: readonly DemoTechnician[] = [
  { firstName: "Miguel", lastName: "Santos", phone: "(555) 016-0001", licenseNumber: "DEMO-APP-10482" },
  { firstName: "Aisha", lastName: "Robinson", phone: "(555) 016-0002", licenseNumber: "DEMO-APP-11217" },
  { firstName: "Pete", lastName: "Kowalski", phone: "(555) 016-0003", licenseNumber: "DEMO-APP-09934" },
];

export type DemoPlan = {
  /** Which of the account's properties, by label. */
  propertyLabel: string;
  serviceType: string;
  recurrence: "weekly" | "biweekly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";
  /** next_due relative to seed day: negative or zero shows in the due lane. */
  dueInDays: number;
  technicianIndex?: number;
  valueCents?: number;
};

export type DemoVisit = {
  propertyLabel: string;
  serviceType: string;
  /** Scheduled start relative to seed day: negative = past visit. */
  inDays: number;
  durationHours: number;
  technicianIndex: number;
  /** Statuses after the initial `scheduled`, walked so the trigger records outcomes. */
  statusPath: readonly ("dispatched" | "in_progress" | "completed" | "cancelled")[];
  completionNotes?: string;
};

export type DemoAccount = {
  name: string;
  kind: "residential" | "commercial";
  /** Statuses after the initial `lead`, walked in order so triggers record each move. */
  statusPath: readonly ("prospect" | "customer" | "inactive")[];
  email: string;
  phone: string;
  billingAddress: string;
  notes?: string;
  contacts: readonly {
    firstName: string;
    lastName: string;
    role?: string;
    email?: string;
    phone?: string;
  }[];
  properties: readonly { label: string; address: string; propertyType?: string; accessNotes?: string }[];
  opportunities: readonly DemoOpportunity[];
  events: readonly DemoEvent[];
  plans?: readonly DemoPlan[];
  visits?: readonly DemoVisit[];
};

export const DEMO_BOOK: readonly DemoAccount[] = [
  {
    name: "Harborlight Foods Distribution",
    kind: "commercial",
    statusPath: ["prospect", "customer"],
    email: "facilities@harborlight-foods.example",
    phone: "(555) 014-2100",
    billingAddress: "14 Dock Road, Portsview, OR 97001",
    notes: "AIB-audited food distributor. Monthly IPM service with quarterly deep inspection of dock doors and racking.",
    contacts: [
      { firstName: "Dana", lastName: "Reyes", role: "Facilities manager", email: "d.reyes@harborlight-foods.example", phone: "(555) 014-2101" },
      { firstName: "Marcus", lastName: "Bell", role: "QA director", email: "m.bell@harborlight-foods.example" },
    ],
    properties: [
      { label: "Distribution Center", address: "14 Dock Road, Portsview, OR 97001", propertyType: "warehouse", accessNotes: "Check in at guard shack; hairnet and hi-vis required on the floor." },
      { label: "Cold Storage Annex", address: "18 Dock Road, Portsview, OR 97001", propertyType: "cold storage" },
    ],
    opportunities: [
      { name: "Annual IPM program", valueCents: 1_848_000, stagePath: ["contacted", "inspection", "proposal", "won"] },
      { name: "Rodent exclusion retrofit — dock doors", valueCents: 620_000, stagePath: ["contacted", "inspection", "proposal"], expectedInDays: 21 },
    ],
    events: [
      { kind: "call", summary: "Intro call; monthly IPM service requested after a failed third-party audit item.", daysAgo: 126 },
      { kind: "email", summary: "Sent audit-readiness overview and service specimen labels.", daysAgo: 121 },
      { kind: "note", summary: "Walkthrough done: activity at dock doors 3 and 7; racking legs clear.", detail: "Recommend 12 exterior stations along the north fence line and door sweeps on 3/7.", daysAgo: 112 },
      { kind: "task", summary: "Schedule quarterly deep inspection for the cold storage annex.", daysAgo: 9 },
    ],
    plans: [
      { propertyLabel: "Distribution Center", serviceType: "Monthly IPM service", recurrence: "monthly", dueInDays: 12, technicianIndex: 0, valueCents: 154_000 },
      { propertyLabel: "Cold Storage Annex", serviceType: "Quarterly deep inspection", recurrence: "quarterly", dueInDays: -2, technicianIndex: 0, valueCents: 89_000 },
    ],
    visits: [
      { propertyLabel: "Distribution Center", serviceType: "Monthly IPM service", inDays: -18, durationHours: 3, technicianIndex: 0, statusPath: ["dispatched", "completed"], completionNotes: "All 12 exterior stations serviced; two with activity at the north fence, rebaited. Door sweeps on 3 and 7 holding." },
      { propertyLabel: "Distribution Center", serviceType: "Monthly IPM service", inDays: 10, durationHours: 3, technicianIndex: 0, statusPath: [] },
    ],
  },
  {
    name: "Bluefin Grill Group",
    kind: "commercial",
    statusPath: ["prospect", "customer"],
    email: "ops@bluefingrill.example",
    phone: "(555) 014-2200",
    billingAddress: "200 Cannery Row, Suite 410, Portsview, OR 97002",
    notes: "Three-location restaurant group. Service windows before 10:00 only; invoices roll up to the group office.",
    contacts: [
      { firstName: "Priya", lastName: "Natarajan", role: "Operations director", email: "priya@bluefingrill.example", phone: "(555) 014-2201" },
      { firstName: "Sam", lastName: "Whitaker", role: "GM — Cannery Row", phone: "(555) 014-2202" },
    ],
    properties: [
      { label: "Bluefin Cannery Row", address: "200 Cannery Row, Portsview, OR 97002", propertyType: "restaurant", accessNotes: "Kitchen access through the alley door; knock twice." },
      { label: "Bluefin Harborside", address: "12 Pier Avenue, Portsview, OR 97002", propertyType: "restaurant" },
      { label: "Bluefin Uptown", address: "88 Grand Boulevard, Portsview, OR 97003", propertyType: "restaurant" },
    ],
    opportunities: [
      { name: "Monthly service — all three locations", valueCents: 1_042_800, stagePath: ["contacted", "inspection", "proposal", "won"] },
    ],
    events: [
      { kind: "call", summary: "Referred by Harborlight; German cockroach pressure at Harborside dish pit.", daysAgo: 98 },
      { kind: "note", summary: "Initial cleanouts done at all three sites; monitors placed and mapped.", daysAgo: 84 },
      { kind: "email", summary: "Monthly service summaries now emailed to the group office after each visit.", daysAgo: 55 },
      { kind: "sms", summary: "Harborside GM texted a photo of a monitor; identified as an occasional invader, no action needed.", daysAgo: 12 },
    ],
    plans: [
      { propertyLabel: "Bluefin Cannery Row", serviceType: "Monthly kitchen service", recurrence: "monthly", dueInDays: 6, technicianIndex: 1, valueCents: 28_900 },
      { propertyLabel: "Bluefin Harborside", serviceType: "Monthly kitchen service", recurrence: "monthly", dueInDays: 0, technicianIndex: 1, valueCents: 28_900 },
    ],
    visits: [
      { propertyLabel: "Bluefin Harborside", serviceType: "Monthly kitchen service", inDays: -25, durationHours: 2, technicianIndex: 1, statusPath: ["dispatched", "completed"], completionNotes: "Dish pit monitors clear two months running; drain treatment refreshed, gel bait rotated." },
    ],
  },
  {
    name: "Stonebridge Hotel & Suites",
    kind: "commercial",
    statusPath: ["prospect", "customer"],
    email: "chief.engineer@stonebridgehotel.example",
    phone: "(555) 014-2300",
    billingAddress: "1 Stonebridge Plaza, Portsview, OR 97004",
    notes: "142-room hotel. Bed bug protocol on retainer; discreet service carts only, no logo shirts in guest corridors.",
    contacts: [
      { firstName: "Owen", lastName: "Gallagher", role: "Chief engineer", email: "o.gallagher@stonebridgehotel.example", phone: "(555) 014-2301" },
      { firstName: "Lucia", lastName: "Mendez", role: "Executive housekeeper" },
    ],
    properties: [
      { label: "Main Tower", address: "1 Stonebridge Plaza, Portsview, OR 97004", propertyType: "hotel", accessNotes: "Service elevator badge from engineering; park in the loading court." },
    ],
    opportunities: [
      { name: "Quarterly preventive + bed bug retainer", valueCents: 1_536_000, stagePath: ["contacted", "proposal", "negotiation", "won"] },
      { name: "Heat treatment — floors 9-11 refresh", valueCents: 435_000, stagePath: ["contacted", "proposal"], expectedInDays: 14 },
    ],
    events: [
      { kind: "call", summary: "Engineering called about a guest report on floor 9; inspection scheduled same day.", daysAgo: 61 },
      { kind: "note", summary: "Canine inspection of floors 9-11: two rooms confirmed, adjacent rooms clear.", daysAgo: 60 },
      { kind: "email", summary: "Sent treatment plan and room-turn schedule to housekeeping.", daysAgo: 59 },
      { kind: "task", summary: "Follow-up canine sweep of treated rooms.", daysAgo: 4 },
    ],
    plans: [
      { propertyLabel: "Main Tower", serviceType: "Quarterly preventive service", recurrence: "quarterly", dueInDays: 34, technicianIndex: 2, valueCents: 384_000 },
    ],
    visits: [
      { propertyLabel: "Main Tower", serviceType: "Bed bug heat treatment — floors 9-11", inDays: -55, durationHours: 8, technicianIndex: 2, statusPath: ["dispatched", "in_progress", "completed"], completionNotes: "Three rooms treated to temperature; adjacent rooms inspected clear. Follow-up canine sweep booked." },
      { propertyLabel: "Main Tower", serviceType: "Follow-up canine sweep", inDays: 3, durationHours: 2, technicianIndex: 2, statusPath: [] },
    ],
  },
  {
    name: "Cascade Grain Mill",
    kind: "commercial",
    statusPath: ["prospect", "customer"],
    email: "plant.manager@cascadegrain.example",
    phone: "(555) 014-2400",
    billingAddress: "5501 Mill Race Road, Alder Falls, OR 97010",
    notes: "Stored-product pest program; fumigation partner handled separately. Pheromone trap counts reported monthly.",
    contacts: [
      { firstName: "Ruth", lastName: "Ellison", role: "Plant manager", email: "r.ellison@cascadegrain.example" },
    ],
    properties: [
      { label: "Mill & Silos", address: "5501 Mill Race Road, Alder Falls, OR 97010", propertyType: "food processing", accessNotes: "Grain-dust area: no phones on the floor, intrinsically safe lights only." },
    ],
    opportunities: [
      { name: "Stored-product pest monitoring program", valueCents: 926_400, stagePath: ["contacted", "inspection", "proposal", "won"] },
    ],
    events: [
      { kind: "call", summary: "Indian meal moth counts trending up in silo gallery; asked for a program bid.", daysAgo: 140 },
      { kind: "note", summary: "Trap grid installed: 24 pheromone traps mapped across mill and gallery.", daysAgo: 119 },
      { kind: "email", summary: "Monthly trend report sent; counts down 60% after sanitation pass.", daysAgo: 30 },
    ],
  },
  {
    name: "Rosewood Senior Living",
    kind: "commercial",
    statusPath: ["prospect", "customer"],
    email: "administrator@rosewoodliving.example",
    phone: "(555) 014-2500",
    billingAddress: "77 Rosewood Lane, Portsview, OR 97005",
    notes: "Assisted living; low-odor products only, service during activity hours, notify the nurses' station on arrival.",
    contacts: [
      { firstName: "Gloria", lastName: "Stanton", role: "Administrator", phone: "(555) 014-2501" },
      { firstName: "Ben", lastName: "Ferris", role: "Maintenance lead" },
    ],
    properties: [
      { label: "Main Residence", address: "77 Rosewood Lane, Portsview, OR 97005", propertyType: "assisted living" },
    ],
    opportunities: [
      { name: "Monthly interior/exterior service", valueCents: 448_800, stagePath: ["contacted", "inspection", "won"] },
    ],
    events: [
      { kind: "call", summary: "Ants in the memory-care wing kitchenette; same-week start requested.", daysAgo: 87 },
      { kind: "note", summary: "Odorous house ants trailing from the courtyard expansion joint; baited and sealed.", daysAgo: 83 },
      { kind: "sms", summary: "Maintenance confirmed no activity two weeks after baiting.", daysAgo: 69 },
    ],
    plans: [
      { propertyLabel: "Main Residence", serviceType: "Monthly interior/exterior service", recurrence: "monthly", dueInDays: -1, technicianIndex: 1, valueCents: 37_400 },
    ],
    visits: [
      { propertyLabel: "Main Residence", serviceType: "Monthly interior/exterior service", inDays: -31, durationHours: 2, technicianIndex: 1, statusPath: ["completed"], completionNotes: "Courtyard expansion joint holding; low-odor perimeter treatment, nurses' station notified on arrival and departure." },
    ],
  },
  {
    name: "Pineview School District",
    kind: "commercial",
    statusPath: ["prospect"],
    email: "grounds@pineviewsd.example",
    phone: "(555) 014-2600",
    billingAddress: "300 District Office Way, Alder Falls, OR 97011",
    notes: "Two campuses under an IPM-first policy: monitoring and exclusion before any application, board reporting each term.",
    contacts: [
      { firstName: "Hector", lastName: "Ruiz", role: "Grounds supervisor", email: "h.ruiz@pineviewsd.example" },
    ],
    properties: [
      { label: "Pineview Elementary", address: "310 Schoolhouse Road, Alder Falls, OR 97011", propertyType: "school" },
      { label: "Pineview Middle School", address: "450 Timber Trail, Alder Falls, OR 97011", propertyType: "school" },
    ],
    opportunities: [
      { name: "District IPM contract — next school year", valueCents: 1_180_000, stagePath: ["contacted", "proposal", "negotiation"], expectedInDays: 35 },
    ],
    events: [
      { kind: "email", summary: "RFP received; site walks scheduled for both campuses.", daysAgo: 44 },
      { kind: "note", summary: "Site walks done; exclusion list drafted (door sweeps, weep hole screens, kitchen thresholds).", daysAgo: 37 },
      { kind: "task", summary: "Present IPM plan at the facilities committee meeting.", daysAgo: 6 },
    ],
  },
  {
    name: "Ironworks Brewing Co",
    kind: "commercial",
    statusPath: ["prospect"],
    email: "taproom@ironworksbrewing.example",
    phone: "(555) 014-2700",
    billingAddress: "9 Foundry Street, Portsview, OR 97006",
    contacts: [
      { firstName: "Kelly", lastName: "Brandt", role: "Taproom manager", phone: "(555) 014-2701" },
    ],
    properties: [
      { label: "Brewery & Taproom", address: "9 Foundry Street, Portsview, OR 97006", propertyType: "brewery" },
    ],
    opportunities: [
      { name: "Fruit fly program — taproom and drains", valueCents: 218_400, stagePath: ["contacted", "inspection"], expectedInDays: 10 },
    ],
    events: [
      { kind: "call", summary: "Fruit flies at the taproom drains ahead of festival weekend.", daysAgo: 16 },
      { kind: "note", summary: "Drain inspection done; bio-foam schedule and squeegee routine proposed.", daysAgo: 13 },
    ],
  },
  {
    name: "Meridian Property Management",
    kind: "commercial",
    statusPath: [],
    email: "portfolio@meridianpm.example",
    phone: "(555) 014-2800",
    billingAddress: "1200 Meridian Tower, Suite 900, Portsview, OR 97007",
    notes: "Manages 14 multifamily buildings; evaluating a single vendor for the whole portfolio.",
    contacts: [
      { firstName: "Ava", lastName: "Lindqvist", role: "Portfolio manager", email: "a.lindqvist@meridianpm.example" },
    ],
    properties: [
      { label: "The Foundry Lofts", address: "40 Foundry Street, Portsview, OR 97006", propertyType: "multifamily" },
    ],
    opportunities: [
      { name: "Portfolio-wide service agreement", valueCents: 3_600_000, stagePath: ["contacted"], expectedInDays: 45 },
    ],
    events: [
      { kind: "email", summary: "Inbound inquiry from the website; asked for multifamily references.", daysAgo: 7 },
      { kind: "task", summary: "Send references and a sample building service plan.", daysAgo: 5 },
    ],
  },
  {
    name: "Sunfield Grocery Co-op",
    kind: "commercial",
    statusPath: ["prospect"],
    email: "storeops@sunfieldcoop.example",
    phone: "(555) 014-2900",
    billingAddress: "610 Market Green, Alder Falls, OR 97012",
    contacts: [
      { firstName: "Noor", lastName: "Haddad", role: "Store operations", phone: "(555) 014-2901" },
    ],
    properties: [
      { label: "Market Green Store", address: "610 Market Green, Alder Falls, OR 97012", propertyType: "grocery" },
    ],
    opportunities: [
      { name: "Weekly produce-area service", valueCents: 561_600, stagePath: ["contacted", "proposal", "lost"], lostReason: "Board chose the incumbent vendor on price; revisit at contract renewal in the spring." },
    ],
    events: [
      { kind: "call", summary: "Walked the produce and bulk aisles; proposal requested by Friday.", daysAgo: 52 },
      { kind: "note", summary: "Proposal delivered; decision went to the co-op board.", daysAgo: 47 },
      { kind: "email", summary: "Board kept the incumbent on price; asked us to re-bid at renewal.", daysAgo: 33 },
    ],
  },
  {
    name: "Bayside Seafood Market",
    kind: "commercial",
    statusPath: [],
    email: "counter@baysideseafood.example",
    phone: "(555) 014-3000",
    billingAddress: "3 Wharf Lane, Portsview, OR 97002",
    contacts: [
      { firstName: "Tom", lastName: "Okonkwo", role: "Owner", phone: "(555) 014-3001" },
    ],
    properties: [
      { label: "Market & Smokehouse", address: "3 Wharf Lane, Portsview, OR 97002", propertyType: "retail food" },
    ],
    opportunities: [],
    events: [
      { kind: "call", summary: "Gulls and flies at the outdoor smoker; wants an exterior program quote.", daysAgo: 2 },
    ],
  },
  {
    name: "The Alvarez Household",
    kind: "residential",
    statusPath: ["prospect", "customer"],
    email: "family@alvarez-home.example",
    phone: "(555) 014-3100",
    billingAddress: "421 Maple Hollow Drive, Portsview, OR 97008",
    contacts: [
      { firstName: "Carmen", lastName: "Alvarez", phone: "(555) 014-3100" },
    ],
    properties: [
      { label: "Home", address: "421 Maple Hollow Drive, Portsview, OR 97008", propertyType: "single family", accessNotes: "Gate code 0421; dog is friendly but keep the side gate latched." },
    ],
    opportunities: [
      { name: "Quarterly home protection plan", valueCents: 79_600, stagePath: ["contacted", "inspection", "won"] },
    ],
    events: [
      { kind: "call", summary: "Carpenter ants in the kitchen wall void; inspection booked.", daysAgo: 205 },
      { kind: "note", summary: "Moisture-damaged sill plate behind the dishwasher; treated voids and flagged the leak for a plumber.", daysAgo: 199 },
      { kind: "sms", summary: "No activity since treatment; quarterly plan started.", daysAgo: 180 },
      { kind: "note", summary: "Routine quarterly visit: exterior perimeter, wasp nest removed at the eave.", daysAgo: 21 },
    ],
    plans: [
      { propertyLabel: "Home", serviceType: "Quarterly home protection", recurrence: "quarterly", dueInDays: 68, technicianIndex: 2, valueCents: 19_900 },
    ],
    visits: [
      { propertyLabel: "Home", serviceType: "Quarterly home protection", inDays: -21, durationHours: 1, technicianIndex: 2, statusPath: ["dispatched", "completed"], completionNotes: "Exterior perimeter treated; wasp nest removed at the east eave; gate latched on the way out." },
    ],
  },
  {
    name: "The Chen Residence",
    kind: "residential",
    statusPath: ["prospect", "customer"],
    email: "wei.chen@chen-home.example",
    phone: "(555) 014-3200",
    billingAddress: "18 Fernbank Court, Alder Falls, OR 97013",
    contacts: [
      { firstName: "Wei", lastName: "Chen", email: "wei.chen@chen-home.example" },
    ],
    properties: [
      { label: "Home", address: "18 Fernbank Court, Alder Falls, OR 97013", propertyType: "single family" },
    ],
    opportunities: [
      { name: "Rodent exclusion + attic cleanout", valueCents: 168_500, stagePath: ["contacted", "inspection", "proposal", "won"] },
    ],
    events: [
      { kind: "call", summary: "Noises in the attic at night; same-week inspection requested.", daysAgo: 74 },
      { kind: "note", summary: "Roof rat entry at the gable vent; exclusion scope written with photos.", daysAgo: 71 },
      { kind: "email", summary: "Exclusion complete; two-week trap check scheduled, warranty issued.", daysAgo: 58 },
    ],
    visits: [
      { propertyLabel: "Home", serviceType: "Rodent exclusion + attic cleanout", inDays: -60, durationHours: 6, technicianIndex: 0, statusPath: ["dispatched", "in_progress", "completed"], completionNotes: "Gable vent screened, two entry points sealed, attic sanitized. Trap check in two weeks under warranty." },
      { propertyLabel: "Home", serviceType: "Two-week trap check", inDays: -46, durationHours: 1, technicianIndex: 0, statusPath: ["cancelled"] },
    ],
  },
  {
    name: "The Okafor Family",
    kind: "residential",
    statusPath: ["prospect"],
    email: "okafor.family@okafor-home.example",
    phone: "(555) 014-3300",
    billingAddress: "902 Cedar Loop, Portsview, OR 97009",
    contacts: [
      { firstName: "Chidi", lastName: "Okafor", phone: "(555) 014-3300" },
    ],
    properties: [
      { label: "Home", address: "902 Cedar Loop, Portsview, OR 97009", propertyType: "single family" },
    ],
    opportunities: [
      { name: "Yellowjacket nest removal + season plan", valueCents: 42_500, stagePath: ["contacted"], expectedInDays: 7 },
    ],
    events: [
      { kind: "call", summary: "Ground nest by the play set; wants removal this week.", daysAgo: 3 },
    ],
  },
  {
    name: "The Whitfield Bungalow",
    kind: "residential",
    statusPath: ["prospect", "customer", "inactive"],
    email: "j.whitfield@whitfield-home.example",
    phone: "(555) 014-3400",
    billingAddress: "5 Larch Street, Alder Falls, OR 97014",
    notes: "Sold the house in the spring; service ended on the move — history retained.",
    contacts: [
      { firstName: "June", lastName: "Whitfield" },
    ],
    properties: [
      { label: "Bungalow", address: "5 Larch Street, Alder Falls, OR 97014", propertyType: "single family" },
    ],
    opportunities: [
      { name: "Spring renewal — quarterly plan", valueCents: 79_600, stagePath: ["contacted", "lost"], lostReason: "Home sold; owner moved out of the service area." },
    ],
    events: [
      { kind: "note", summary: "Quarterly service for two years; spider and earwig pressure controlled.", daysAgo: 320 },
      { kind: "call", summary: "June called: house is sold, closing next month; cancel the renewal.", daysAgo: 95 },
      { kind: "note", summary: "Account deactivated on move-out; left the new-owner welcome flyer.", daysAgo: 88 },
    ],
  },
];

/** Expected insert counts, so the seeder and its tests agree on the totals. */
export function demoBookTotals() {
  return DEMO_BOOK.reduce(
    (totals, account) => ({
      accounts: totals.accounts + 1,
      contacts: totals.contacts + account.contacts.length,
      properties: totals.properties + account.properties.length,
      opportunities: totals.opportunities + account.opportunities.length,
      plans: totals.plans + (account.plans?.length ?? 0),
      workOrders: totals.workOrders + (account.visits?.length ?? 0),
      manualEvents: totals.manualEvents + account.events.length,
      statusMoves: totals.statusMoves + account.statusPath.length,
      stageMoves:
        totals.stageMoves
        + account.opportunities.reduce((sum, opportunity) => sum + opportunity.stagePath.length, 0),
      // Only completed and cancelled visits write timeline outcomes;
      // dispatch progress is deliberately not history.
      visitOutcomes:
        totals.visitOutcomes
        + (account.visits ?? []).reduce(
          (sum, visit) =>
            sum
            + visit.statusPath.filter((status) => status === "completed" || status === "cancelled")
              .length,
          0,
        ),
    }),
    {
      accounts: 0,
      contacts: 0,
      properties: 0,
      opportunities: 0,
      plans: 0,
      workOrders: 0,
      manualEvents: 0,
      statusMoves: 0,
      stageMoves: 0,
      visitOutcomes: 0,
    },
  );
}
