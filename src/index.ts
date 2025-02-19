import { vValidator } from "@hono/valibot-validator";
import * as v from "valibot";

import { createApp } from "./utils/hono";
import { clientMiddleware, EnsPublicClient, Network, networkMiddleware, NetworkMiddlewareEnv } from "./utils/chains";
import { Address } from "viem";
import { Hex } from "viem";
import { getOwnerAndAvailable } from "./utils/owner";
import { isAddress } from "viem";
import { sha256 } from "hono/utils/crypto";
import { normalize } from "viem/ens";
import { getVerifiedAddress } from "./utils/eth";

const app = createApp();

const networkRouter = createApp<NetworkMiddlewareEnv>().use(networkMiddleware);

const findAndPromoteUnregisteredAvatar = async ({
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

  do {
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
  // eslint-disable-next-line no-constant-condition
  } while (true);

  return {
    file: unregisteredAvatarFile,
    body: b2,
  };
};

const dataURLToBytes = (dataURL: string) => {
  const base64 = dataURL.split(",")[1];
  const mime = dataURL.split(",")[0].split(":")[1].split(";")[0];
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return { mime, bytes };
};

networkRouter.get("/:name", clientMiddleware, async (c) => {
  const name = c.req.param("name");
  const { network, client } = c.var;

  const existingAvatarFile = await c.env.AVATAR_BUCKET.get(`${network}/registered/${name}`);

  if (existingAvatarFile && existingAvatarFile.httpMetadata?.contentType === "image/jpeg") {
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", existingAvatarFile.size.toString());

    return c.body(existingAvatarFile.body);
  }

  const unregisteredAvatar = await findAndPromoteUnregisteredAvatar({
    env: c.env,
    network,
    name,
    client,
  });

  if (unregisteredAvatar) {
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", unregisteredAvatar.file.size.toString());

    return c.body(unregisteredAvatar.body);
  }

  return c.text(`${name} not found on ${network}`, 404);
});

const uploadSchema = v.object({
  expiry: v.pipe(
    v.string("expiry value is missing"),
    v.regex(/^\d+$/, "expiry value is not number"),
  ),
  dataURL: v.string("dataURL value is missing"),
  sig: v.pipe(
    v.string("sig value is missing"),
    v.hexadecimal("sig value is not hex"),
  ),
  unverifiedAddress: v.pipe(
    v.string("unverifiedAddress value is missing"),
    v.hexadecimal("unverifiedAddress value is not hex"),
    v.check(
      isAddress,
      "unverifiedAddress value is not address",
    ),
  ),
});

const MAX_IMAGE_SIZE = 1024 * 512;

networkRouter.put("/:name", clientMiddleware, vValidator("json", uploadSchema), async (c) => {
  const name = c.req.param("name");
  const { expiry, dataURL, sig, unverifiedAddress } = c.req.valid("json");
  const { network, client } = c.var;

  const { mime, bytes } = dataURLToBytes(dataURL);
  const hash = await sha256(bytes);

  if (!hash) {
    return c.text("Failed to hash image", 500);
  }

  if (mime !== "image/jpeg")
    return c.text("File must be of type image/jpeg", 415);

  if (name !== normalize(name))
    return c.text("Name must be in normalized form", 400);

  console.log("hash", hash);

  const verifiedAddress = await getVerifiedAddress({
    client,
    sig: sig as Hex,
    expiry,
    name,
    hash: `0x${hash}`,
    unverifiedAddress: unverifiedAddress as Address,
  });

  if (!verifiedAddress) {
    return c.text("Invalid signature", 400);
  }

  if (bytes.byteLength > MAX_IMAGE_SIZE) {
    return c.text("Image is too large", 413);
  }

  const { available, owner } = await getOwnerAndAvailable({ client, name });

  if (!available) {
    if (!owner) {
      return c.text("Name not found", 404);
    }
    else if (verifiedAddress !== owner) {
      return c.text(`Address ${verifiedAddress} is not the owner of ${name}`, 403);
    }
  }

  if (parseInt(expiry) < Date.now()) {
    return c.text("Signature expired", 403);
  }

  const bucket = c.env.AVATAR_BUCKET;
  const key = available
    ? `${network}/unregistered/${name}/${verifiedAddress}`
    : `${network}/registered/${name}`;

  const uploaded = await bucket.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  if (uploaded.key === key) {
    return c.json({ message: "uploaded" }, 200);
  }
  else {
    return c.text(`${name} not uploaded`, 500);
  }
});

app.route("/", networkRouter);
app.route("/:network", networkRouter);

export default app;
