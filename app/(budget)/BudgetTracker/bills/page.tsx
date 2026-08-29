import { BudgetTrackerConsole } from "@/components/budget/console";

export const metadata = { title: "Bills & Debt" };

export default function BudgetBillsPage() {
  return <BudgetTrackerConsole section="bills" />;
}
