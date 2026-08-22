import type { AppRouterClient } from "@gambi/board/router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const ADMIN_TOKEN_KEY = "gambi.board.admin-token";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => toast.error(error.message),
  }),
});

export const link = new RPCLink({
  url: `${typeof window === "undefined" ? "http://127.0.0.1:3001" : window.location.origin}/rpc`,
  headers: () => {
    if (typeof window === "undefined") {
      return {};
    }
    const token = window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
    return token ? { "x-board-admin-token": token } : {};
  },
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);
export type BoardState = Awaited<ReturnType<AppRouterClient["board"]["state"]>>;
