import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Registers the Convex Auth HTTP endpoints (token exchange, etc.).
auth.addHttpRoutes(http);

export default http;
