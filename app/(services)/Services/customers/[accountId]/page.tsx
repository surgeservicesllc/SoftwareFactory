import { ServicesAccountDetail } from "@/components/services/account-detail";

export const metadata = { title: "Account" };

export default async function ServicesAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <ServicesAccountDetail accountId={accountId} />;
}
