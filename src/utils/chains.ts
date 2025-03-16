import { addEnsContracts, createEnsPublicClient } from "@ensdomains/ensjs";
import { mainnet, goerli, sepolia, holesky } from "viem/chains";
import { BaseEnv } from "./hono";
import { createMiddleware } from "hono/factory";
import { http } from "viem";

export const chains = [
  addEnsContracts(mainnet),
  addEnsContracts(goerli),
  addEnsContracts(sepolia),
  addEnsContracts(holesky),
] as const;

export type Chain = (typeof chains)[number];
export type Network = "mainnet" | "goerli" | "sepolia" | "holesky";
export type EnsPublicClient = ReturnType<typeof createEnsPublicClient>;

export const getChainFromNetwork = (_network: string) => {
  const lowercased = _network.toLowerCase();
  const network = lowercased === "mainnet" ? "ethereum" : lowercased;
  return chains.find(chain => chain.name.toLowerCase() === network);
};

export type NetworkMiddlewareEnv = {
  Variables: {
    chain: Chain;
    network: Network;
  };
};

export const networkMiddleware = createMiddleware<
  BaseEnv & NetworkMiddlewareEnv
>(async (c, next) => {
  const network = c.req.param("network")?.toLowerCase() ?? "mainnet";
  const chain = getChainFromNetwork(network);

  if (!chain) {
    return c.text("Network is not supported", 400);
  }

  c.set("chain", chain);
  c.set("network", network as Network);

  await next();
});

export type ClientMiddlewareEnv = NetworkMiddlewareEnv & {
  Variables: {
    client: EnsPublicClient;
  };
};
export const clientMiddleware = createMiddleware<BaseEnv & ClientMiddlewareEnv>(
  async (c, next) => {
    const endpointMap = JSON.parse(c.env.WEB3_ENDPOINT_MAP) as Record<
      Network,
      string
    >;
    const client = createEnsPublicClient({
      chain: c.var.chain,
      transport: http(endpointMap[c.var.network]),
    });

    c.set("client", client);

    await next();
  },
);
