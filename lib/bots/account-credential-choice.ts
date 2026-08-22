import {
  isBrokerProviderId,
  slotIndexForPurpose,
} from "@/lib/ai-accounts/purposes";

const PROVISION_CREDENTIAL_PATTERN =
  /^subscription(?:_(?:[2-9]|[1-9][0-9]{1,3}))?$/;

/**
 * Translate the broker's provider-specific account purpose (`claude_2`,
 * `codex_3`, …) into the provision route's deliberately abstract credential
 * choice (`subscription_2`, `subscription_3`, …).
 *
 * Purpose names are metadata, never credential material. A provider/purpose
 * mismatch is rejected instead of silently pointing a bot at another slot.
 * The abstract form remains accepted during rolling upgrades.
 */
export function accountProvisionCredentialChoice(
  providerId: string,
  credentialPurpose: string | null | undefined,
): string | null {
  if (!isBrokerProviderId(providerId) || !credentialPurpose) return null;
  if (PROVISION_CREDENTIAL_PATTERN.test(credentialPurpose)) return credentialPurpose;

  const slotIndex = slotIndexForPurpose(providerId, credentialPurpose);
  if (slotIndex === null) return null;
  return slotIndex === 0 ? "subscription" : `subscription_${slotIndex + 1}`;
}
