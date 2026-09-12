import { Hono } from "hono";
import { getPlayEstimate } from "../play/estimate.ts";
import { getPlay, provisionPlay } from "../play/provision.ts";

const app = new Hono();

app.get("/estimate", (c) => getPlayEstimate(c));
app.post("/", (c) => provisionPlay(c));
app.get("/", (c) => getPlay(c));

export default app;
