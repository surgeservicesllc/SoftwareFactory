import { BudgetTrackerConsole } from "@/components/budget/console";

export const metadata = { title: "Transactions" };

export default function BudgetTransactionsPage() {
  return <BudgetTrackerConsole section="transactions" />;
}
