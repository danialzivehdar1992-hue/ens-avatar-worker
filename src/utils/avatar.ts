import { EnsPublicClient, Network } from "./chains";
import { getOwnerAndAvailable } from "./owner";

export const findAndPromoteUnregisteredAvatar = async ({
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

  const unregisteredAvatarFile = await env.AVATAR_BUCKET.get(`${network}/unregistered/${name}/${owner}`);

  if (!unregisteredAvatarFile) {
    return;
  }

  const [b1, b2] = unregisteredAvatarFile.body.tee();

  await env.AVATAR_BUCKET.put(`${network}/registered/${name}`, b1, {
    httpMetadata: unregisteredAvatarFile.httpMetadata,
  });

  let cursor: string | undefined = undefined;

  while (true) {
    const { objects, ...rest } = await env.AVATAR_BUCKET.list({
      prefix: `${network}/unregistered/${name}/`,
      cursor,
    });

    const keys = objects.map(o => o.key);
    if (!keys.length) {
      break;
    }

    await env.AVATAR_BUCKET.delete(keys);
    if (rest.truncated) {
      cursor = rest.cursor;
    }
    else {
      break;
    }
  }

  return {
    file: unregisteredAvatarFile,
    body: b2,
  };
};
