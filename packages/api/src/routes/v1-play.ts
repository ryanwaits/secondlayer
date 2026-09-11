import { Hono } from "hono";
import { getPlay, provisionPlay } from "../play/provision.ts";

const app = new Hono();

app.post("/", (c) => provisionPlay(c));
app.get("/", (c) => getPlay(c));

export default app;
