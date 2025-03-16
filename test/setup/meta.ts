import type { Mock } from "vitest";

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

export type ModuleMock<TModule extends Record<string, unknown>> = Partial<{
  [K in keyof TModule]: TModule[K] extends (...args: unknown[]) => unknown
    ? Mock<TModule[K]>
    : TModule[K];
}>;
