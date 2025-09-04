import type { ConnectRouter } from "@connectrpc/connect";
// import from the PB file (v2 exports the service here)
import { HealthService } from "../../../packages/api/gen/health/v1/health_pb.js";

export default function routes(router: ConnectRouter) {
  router.service(HealthService, {
    async check() {
      return { status: "ok(connect)" };
    },
  });
}
