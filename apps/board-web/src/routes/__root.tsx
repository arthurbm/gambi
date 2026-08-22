import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { MapIcon, ShieldIcon, UserRoundIcon } from "lucide-react";
import { useEffect } from "react";

import { Toaster } from "@/components/ui/sonner";
import { type orpc, queryClient } from "@/lib/orpc";
import { subscribeToBoard } from "@/lib/sse";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "Livro de campo · Gambi" },
      {
        name: "description",
        content:
          "Board local do Gambiarra Club para acompanhar squads e rodadas.",
      },
    ],
  }),
});

function RootComponent() {
  useEffect(() => subscribeToBoard(queryClient), []);

  return (
    <>
      <HeadContent />
      <nav aria-label="Rotas do board" className="route-tabs">
        <span aria-hidden="true" className="route-mark">
          Gambi · Livro de campo
        </span>
        <Link activeProps={{ "aria-current": "page" }} to="/">
          <MapIcon aria-hidden="true" />
          Cidade
        </Link>
        <Link activeProps={{ "aria-current": "page" }} to="/me">
          <UserRoundIcon aria-hidden="true" />
          Meu squad
        </Link>
        <Link activeProps={{ "aria-current": "page" }} to="/admin">
          <ShieldIcon aria-hidden="true" />
          Admin
        </Link>
      </nav>
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  );
}
