import { Hono } from "hono/tiny";
import type { Env as HonoEnv } from "hono/types";

export type BaseEnv = {
  Bindings: Env;
};

export const createApp = <E extends HonoEnv>() => new Hono<BaseEnv & E>();
