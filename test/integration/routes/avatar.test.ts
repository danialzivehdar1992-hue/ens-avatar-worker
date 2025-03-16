import { describe, expect, test, vi, beforeEach, assert } from "vitest";
import * as media from "@/utils/media";
import * as eth from "@/utils/eth";
import * as owner from "@/utils/owner";
import * as data from "@/utils/data";
import { ModuleMock } from "@test/setup/meta";
import { env } from "cloudflare:test";
import { normalize } from "viem/ens";
import app from "@/index";
import { createTestUploadData, TEST_ACCOUNT } from "@test/setup/helpers";
import { sha256 } from "viem/utils";

// Mocks
vi.mock("@/utils/owner", () => ({
  getOwnerAndAvailable: vi.fn(),
}) satisfies ModuleMock<typeof owner>);

// Test constants
const MOCK_NAME = "test.eth";
const NORMALIZED_NAME = normalize("test.eth");
const MOCK_NETWORKS = ["mainnet", "goerli", "sepolia", "holesky"] as const;
const MAX_IMAGE_SIZE = 1024 * 512;

describe("Avatar Routes", () => {
  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();
  });

  const bucketSpy = {
    get: vi.spyOn(env.AVATAR_BUCKET, "get"),
    put: vi.spyOn(env.AVATAR_BUCKET, "put"),
  };

  const findAndPromoteUnregisteredMediaSpy = vi.spyOn(media, "findAndPromoteUnregisteredMedia");

  describe("GET /:name", () => {
    test("returns 200 with the avatar image when the avatar exists in registered storage", async () => {
      // Mock registered avatar exists
      const imageContent = new Uint8Array([1, 2, 3, 4, 5]);
      await env.AVATAR_BUCKET.put(media.MEDIA_BUCKET_KEY.registered("mainnet", MOCK_NAME), imageContent, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      // Make the request
      const res = await app.request(`/${MOCK_NAME}`, {}, env);

      // Verify result
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Content-Length")).toBe(imageContent.length.toString());

      // Verify correct key was used
      expect(bucketSpy.get).toHaveBeenCalledWith(
        media.MEDIA_BUCKET_KEY.registered("mainnet", MOCK_NAME),
      );

      // Verify body matches
      const buffer = await res.arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(imageContent);
    });

    test("correctly promotes and returns an unregistered avatar when the name becomes registered", async () => {
      // Mock unregistered avatar exists and is promoted
      const imageBuffer = new Uint8Array([10, 20, 30, 40]);

      await env.AVATAR_BUCKET.put(media.MEDIA_BUCKET_KEY.unregistered("mainnet", MOCK_NAME, TEST_ACCOUNT.address), imageBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        owner: TEST_ACCOUNT.address,
        available: false,
      });

      // Make the request
      const res = await app.request(`/${MOCK_NAME}`, {}, env);

      // Verify result
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Content-Length")).toBe(imageBuffer.length.toString());

      expect(bucketSpy.get).toHaveBeenCalledWith(
        media.MEDIA_BUCKET_KEY.registered("mainnet", MOCK_NAME),
      );

      // Verify the function was called with correct params
      expect(findAndPromoteUnregisteredMediaSpy).toHaveBeenCalledWith({
        env,
        network: "mainnet",
        name: MOCK_NAME,
        client: expect.anything(),
        mediaType: "avatar",
      });

      const putResult = await env.AVATAR_BUCKET.get(media.MEDIA_BUCKET_KEY.registered("mainnet", MOCK_NAME));

      assert(putResult);
      expect(putResult.httpMetadata?.contentType).toBe("image/jpeg");
      expect(await putResult.arrayBuffer()).toEqual(imageBuffer.buffer);
    });

    test("returns 404 when no avatar exists for the name", async () => {
      // Mock unregistered avatar doesn't exist
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        owner: null,
        available: true,
      });

      // Make the request
      const res = await app.request(`/${MOCK_NAME}`, {}, env);

      // Verify result
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(`${MOCK_NAME} not found on mainnet`);
    });

    test.each(MOCK_NETWORKS)("works with network %s", async (network) => {
      // Mock unregistered avatar doesn't exist
      findAndPromoteUnregisteredMediaSpy.mockResolvedValue(undefined);

      // Make the request
      const res = await app.request(`/${network}/${MOCK_NAME}`, {}, env);

      // Verify result shows correct network
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(`${MOCK_NAME} not found on ${network}`);

      // Verify the function was called with correct network
      expect(findAndPromoteUnregisteredMediaSpy).toHaveBeenCalledWith(
        expect.objectContaining({ network }),
      );
    });
  });

  describe("PUT /:name", () => {
    const uploadAvatar = async (name: string, dataURL: string, network: string, expiry?: string) => {
      const imageBuffer = data.dataURLToBytes(dataURL).bytes;
      const imageHash = sha256(imageBuffer);

      const testData = await createTestUploadData("avatar", name, imageHash, expiry);

      const res = await app.request(`/${network}/${name}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiry: testData.expiry,
          dataURL: dataURL,
          sig: testData.sig,
          unverifiedAddress: testData.address,
        }),
      }, env);

      return {
        res,
        imageBuffer,
        imageHash,
        testData,
      };
    };

    test("returns 200 when upload is successful for a registered name owned by the sender", async () => {
      // Mock name is registered and owned by sender
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: TEST_ACCOUNT.address,
      });

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res, imageBuffer } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchInlineSnapshot(`
        {
          "message": "uploaded",
        }
      `);

      // Verify the file was uploaded to the registered path
      expect(bucketSpy.put).toHaveBeenCalledWith(
        media.MEDIA_BUCKET_KEY.registered("mainnet", NORMALIZED_NAME),
        imageBuffer,
        { httpMetadata: { contentType: "image/jpeg" } },
      );
    });

    test("returns 200 when upload is successful for an available name", async () => {
      // Mock name is available
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: true,
        owner: null,
      });

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res, imageBuffer } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchInlineSnapshot(`
        {
          "message": "uploaded",
        }
      `);

      // Verify the file was uploaded to the unregistered path
      expect(bucketSpy.put).toHaveBeenCalledWith(
        media.MEDIA_BUCKET_KEY.unregistered("mainnet", NORMALIZED_NAME, TEST_ACCOUNT.address),
        imageBuffer,
        { httpMetadata: { contentType: "image/jpeg" } },
      );
    });

    test("returns 400 when the name is not in normalized form", async () => {
      // Use non-normalized name
      const nonNormalizedName = "TeSt.eth";
      const getVerifiedAddressSpy = vi.spyOn(eth, "getVerifiedAddress");

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(nonNormalizedName, dataURL, "mainnet");

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Name must be in normalized form");

      // Verify no verification or upload was attempted
      expect(getVerifiedAddressSpy).not.toHaveBeenCalled();
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 400 when the signature is invalid", async () => {
      // Mock signature verification fails
      vi.mocked(eth.getVerifiedAddress).mockResolvedValue(null);

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Invalid signature");

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 403 when the signature has expired", async () => {
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: TEST_ACCOUNT.address,
      });

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet", (Date.now() - 1000).toString());

      expect(await res.text()).toBe("Signature expired");
      expect(res.status).toBe(403);

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 403 when the uploader is not the owner of a registered name", async () => {
      // Mock name is registered but owned by someone else
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: "0x9876543210987654321098765432109876543210",
      });

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(403);
      expect(await res.text()).toBe(`Address ${TEST_ACCOUNT.address} is not the owner of ${NORMALIZED_NAME}`);

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 404 when the name does not exist and is not available", async () => {
      // Mock name doesn't exist and is not available
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: null,
      });

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Name not found");

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 413 when the image is too large", async () => {
      // Mock oversized image
      const oversizedImageBytes = new Uint8Array(MAX_IMAGE_SIZE + 1);
      const base64 = btoa(
        Array.from(oversizedImageBytes)
          .map(byte => String.fromCharCode(byte))
          .join(""),
      );
      const dataURL = `data:image/jpeg;base64,${base64}`;

      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(413);
      expect(await res.text()).toBe("Image is too large");

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 415 when the image is not a JPEG", async () => {
      // Mock unsupported image type
      const dataURL = "data:image/png;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(415);
      expect(await res.text()).toBe("File must be of type image/jpeg");

      // Verify no upload was attempted
      expect(bucketSpy.put).not.toHaveBeenCalled();
    });

    test("returns 500 when upload fails", async () => {
      // Mock name is registered and owned by sender
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: TEST_ACCOUNT.address,
      });

      // Mock upload failure (key mismatch)
      bucketSpy.put.mockResolvedValue({
        key: "wrong-key",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const dataURL = "data:image/jpeg;base64,test123123";
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, "mainnet");

      expect(res.status).toBe(500);
      expect(await res.text()).toBe(`${NORMALIZED_NAME} not uploaded`);
    });

    test.each(MOCK_NETWORKS)("works with network %s", async (network) => {
      // Mock name is registered and owned by sender
      vi.mocked(owner.getOwnerAndAvailable).mockResolvedValue({
        available: false,
        owner: TEST_ACCOUNT.address,
      });

      // Mock successful upload
      const imageBuffer = new Uint8Array([10, 20, 30, 40]);

      await env.AVATAR_BUCKET.put(media.MEDIA_BUCKET_KEY.unregistered(network, NORMALIZED_NAME, TEST_ACCOUNT.address), imageBuffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      const dataURL = `data:image/jpeg;base64,${btoa(Array.from(imageBuffer).map(byte => String.fromCharCode(byte)).join(""))}`;
      const { res } = await uploadAvatar(NORMALIZED_NAME, dataURL, network);

      expect(res.status).toBe(200);

      // Verify upload was to the correct network
      expect(bucketSpy.put).toHaveBeenCalledWith(
        media.MEDIA_BUCKET_KEY.registered(network, NORMALIZED_NAME),
        imageBuffer,
        { httpMetadata: { contentType: "image/jpeg" } },
      );
    });
  });
});
