import { EnsPublicClient, Network } from "./chains";
import { getOwnerAndAvailable } from "./owner";

export const findAndPromoteUnregisteredHeader = async ({
  env,
  network,
  name,
  client,
}: {
  env: Env;
  client: EnsPublicClient;
  network: Network;
  name: string;
}) => {
  const { owner, available } = await getOwnerAndAvailable({ client, name });

  if (available || !owner) {
    return;
  }

  const unregisteredHeaderFile = await env.HEADER_BUCKET.get(`${network}/unregistered/${name}/${owner}`);

  if (!unregisteredHeaderFile) {
    return;
  }

  const [b1, b2] = unregisteredHeaderFile.body.tee();

  await env.HEADER_BUCKET.put(`${network}/registered/${name}`, b1, {
    httpMetadata: unregisteredHeaderFile.httpMetadata,
  });

  let cursor: string | undefined = undefined;

  while (true) {
    const { objects, ...rest } = await env.HEADER_BUCKET.list({
      prefix: `${network}/unregistered/${name}/`,
      cursor,
    });

    const keys = objects.map(o => o.key);
    if (!keys.length) {
      break;
    }

    await env.HEADER_BUCKET.delete(keys);
    if (rest.truncated) {
      cursor = rest.cursor;
    }
    else {
      break;
    }
  }

  return {
    file: unregisteredHeaderFile,
    body: b2,
  };
};
