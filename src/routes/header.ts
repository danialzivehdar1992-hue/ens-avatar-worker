import { vValidator } from "@hono/valibot-validator";
import * as v from "valibot";
import { createApp } from "../utils/hono";
import { clientMiddleware, NetworkMiddlewareEnv } from "../utils/chains";
import { Address, isAddress } from "viem";
import { Hex } from "viem";
import { sha256 } from "hono/utils/crypto";
import { normalize } from "viem/ens";
import { getVerifiedAddress } from "../utils/eth";
import { getOwnerAndAvailable } from "../utils/owner";
import { findAndPromoteUnregisteredHeader } from "@/utils/header";
import { dataURLToBytes } from "@/utils/data";

const router = createApp<NetworkMiddlewareEnv>();

const MAX_IMAGE_SIZE = 1024 * 512;

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

router.get("/:name/h", clientMiddleware, async (c) => {
  const name = c.req.param("name");
  const { network, client } = c.var;

  const existingHeaderFile = await c.env.HEADER_BUCKET.get(`${network}/registered/${name}`);

  if (existingHeaderFile && existingHeaderFile.httpMetadata?.contentType === "image/jpeg") {
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", existingHeaderFile.size.toString());

    return c.body(existingHeaderFile.body);
  }

  const unregisteredHeader = await findAndPromoteUnregisteredHeader({
    env: c.env,
    network,
    name,
    client,
  });

  if (unregisteredHeader) {
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", unregisteredHeader.file.size.toString());

    return c.body(unregisteredHeader.body);
  }

  return c.text(`${name} not found on ${network}`, 404);
});

router.put("/:name/h", clientMiddleware, vValidator("json", uploadSchema), async (c) => {
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

  const bucket = c.env.HEADER_BUCKET;
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

export default router;
