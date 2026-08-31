/**
 * The shapes the Budget Tracker's panels exchange.
 *
 * Kept in one module rather than inline per component so the console, the
 * panels and the tests all describe the same account — a duplicated shape is
 * a shape that will disagree with itself the first time a column is added.
 */

export type AccountView = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly kind: string;
  readonly last4: string | null;
  readonly currentBalanceCents: number;
  readonly creditLimitCents: number | null;
  readonly aprBps: number | null;
  readonly promoAprEndsOn: string | null;
  readonly isActive: boolean;
};

export type ObligationView = {
  readonly id: string;
  readonly accountId: string | null;
  readonly name: string;
  readonly dueDay: number;
  readonly amountCents: number;
  readonly balanceCents: number | null;
  readonly creditLimitCents: number | null;
  readonly aprBps: number | null;
  readonly status: string;
  readonly paidFrom: string | null;
  readonly ownerLabel: string | null;
  readonly payoffRank: number | null;
  readonly autopay: boolean;
};

export type TransactionView = {
  readonly id: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  readonly postedOn: string;
  readonly kind: string;
  readonly description: string;
  readonly amountCents: number;
  readonly balanceAfterCents?: number | null;
  readonly transferGroupId?: string | null;
};

export type CategoryView = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly tone: string;
  readonly monthlyLimitCents: number | null;
  readonly isArchived: boolean;
};

export type ImportBatchView = {
  readonly id: string;
  readonly sourceName: string;
  readonly sheetName: string | null;
  readonly rowsRead: number;
  readonly rowsImported: number;
  readonly rowsSkipped: number;
  readonly notice: string | null;
  readonly createdAt: string;
};

export type FlowView = {
  readonly month: string;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly netCents: number;
  readonly transactionCount: number;
};

export type BudgetOverview = {
  readonly accounts: readonly AccountView[];
  readonly obligations: readonly ObligationView[];
  readonly flows: readonly FlowView[];
  readonly recent: readonly TransactionView[];
  readonly imports: readonly ImportBatchView[];
};

/** The account kinds, with the words a person reads rather than the enum. */
export const ACCOUNT_KIND_LABEL: Readonly<Record<string, string>> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  loan: "Loan",
  mortgage: "Mortgage",
  brokerage: "Brokerage",
  other: "Other",
};

export const TRANSACTION_KIND_LABEL: Readonly<Record<string, string>> = {
  deposit: "Deposit",
  debit: "Debit",
  check: "Check",
  fee: "Fee",
  atm_credit: "ATM credit",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjustment",
};

export const OBLIGATION_STATUS_LABEL: Readonly<Record<string, string>> = {
  scheduled: "Scheduled",
  paid: "Paid",
  repeats_monthly: "Repeats monthly",
  overdue: "Overdue",
  closed: "Closed",
};
