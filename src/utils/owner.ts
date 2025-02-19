import { EnsPublicClient } from "./chains";

export const getOwnerAndAvailable = async ({
  client,
  name,
}: {
  client: EnsPublicClient;
  name: string;
}) => {
  const labels = name.split(".");
  const isDotEth = labels.length >= 2 && labels.at(-1) === "eth";

  const [ownership, available] = await Promise.all([
    client.getOwner({ name }),
    isDotEth ? client.getAvailable({ name }) : false,
  ]);

  return {
    owner: ownership?.owner ?? null,
    available,
  };
};
