import { Address } from "viem";
import { EnsPublicClient } from "./chains";

export const isSubnameAndParentOwner = async ({
  name,
  client,
  verifiedAddress,
}: {
  name: string;
  client: EnsPublicClient;
  verifiedAddress: Address;
}) => {
  if (name.split(".").length <= 2) return false;

  const parentOwner = await client.getOwner({ name: name.split(".").slice(1).join(".") });
  if (parentOwner?.owner?.toLowerCase() !== verifiedAddress.toLowerCase()) return false;

  return true;
};
