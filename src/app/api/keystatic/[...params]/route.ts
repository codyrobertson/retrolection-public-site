import { makeRouteHandler } from "@keystatic/next/route-handler";
import config from "../../../../../keystatic.config";

// local storage writes straight to this machine's disk, and Keystatic doesn't stop it outside
// `next dev`: anywhere else (a production server, a shared tunnel) the editor's backend is shut
const open = config.storage.kind !== "local" || process.env.NODE_ENV === "development";
const handler = makeRouteHandler({ config });
const shut = () => new Response("Not Found", { status: 404 });

export const GET = open ? handler.GET : shut;
export const POST = open ? handler.POST : shut;
