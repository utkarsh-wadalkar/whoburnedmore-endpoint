import { STATUS_CACHE_SECONDS } from "../../../lib/cache-config";
import { getPublicServiceStatus } from "../../../lib/service-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const status = await getPublicServiceStatus();
  return Response.json(status, {
    headers: {
      "cache-control": `public, max-age=0, s-maxage=${STATUS_CACHE_SECONDS}, must-revalidate`,
      "x-content-type-options": "nosniff",
    },
  });
}
