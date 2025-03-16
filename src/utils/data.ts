import { sha256 } from "viem/utils";

export const dataURLToBytes = (dataURL: string) => {
  const base64 = dataURL.split(",")[1];
  const mime = dataURL.split(",")[0].split(":")[1].split(";")[0];
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return { mime, bytes };
};

export const makeHashFromDataUrl = (dataUrl: string) => {
  const { bytes } = dataURLToBytes(dataUrl);
  return sha256(bytes);
};
