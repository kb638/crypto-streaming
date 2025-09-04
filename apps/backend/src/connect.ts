import type { ConnectRouter } from "@connectrpc/connect";
import { HealthService } from "../../../packages/api/gen/health/v1/health_connect.js";

export default function routes(router: ConnectRouter) {
  router.service(HealthService, {
    async check() {
      return { status: "ok(connect)" };
    },
  });
}
