import { cors } from "hono/cors";

import avatarRouter from "./routes/avatar";
import headerRouter from "./routes/header";
import { type NetworkMiddlewareEnv, networkMiddleware } from "./utils/chains";
import { createApp } from "./utils/hono";

const app = createApp();
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const requestOrigin = c.req.header("Origin") || "";
      // We rely on ENVIRONMENT from wrangler config
      const isProd = c.env.ENVIRONMENT === "production";

      // If production environment: only allow subdomains of ens.domains
      if (isProd) {
        try {
          const hostname = new URL(requestOrigin).hostname;
          // e.g. myapp.ens.domains or abc.def.ens.domains
          if (hostname.endsWith(".ens.domains")) {
            return requestOrigin; // reflect subdomain
          }
        } catch {
          // If it's not a valid URL, deny
        }
        return ""; // empty => disallowed
      }

      // Otherwise (development), allow all
      return "*";
    },
    allowMethods: ["GET", "PUT", "POST", "OPTIONS", "DELETE"],
  }),
);
const networkRouter = createApp<NetworkMiddlewareEnv>().use(networkMiddleware);

networkRouter.route("/", avatarRouter);
networkRouter.route("/", headerRouter);

app.route("/", networkRouter);
app.route("/:network", networkRouter);

export default app;
