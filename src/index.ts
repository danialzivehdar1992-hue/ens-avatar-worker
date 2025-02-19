import { createApp } from "./utils/hono";
import { NetworkMiddlewareEnv, networkMiddleware } from "./utils/chains";
import avatarRouter from "./routes/avatar";
import headerRouter from "./routes/header";

const app = createApp();
const networkRouter = createApp<NetworkMiddlewareEnv>().use(networkMiddleware);

networkRouter.route("/", avatarRouter);
networkRouter.route("/", headerRouter);

app.route("/", networkRouter);
app.route("/:network", networkRouter);

export default app;
