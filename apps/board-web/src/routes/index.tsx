import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleAlertIcon, RadioIcon, UserRoundIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { orpc } from "@/lib/orpc";
import { useBoardConnectionStatus } from "@/lib/sse";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: HomeComponent });

const PHASE_LABELS: Record<string, string> = {
  finale: "Finale",
  lobby: "Lobby",
  "round:1": "Rodada 1 · Fundação",
  "round:2": "Rodada 2 · Construção",
  "round:3": "Rodada 3 · Serviço público",
  "round:4": "Rodada 4 · Metrô",
  "round:5": "Rodada 5 · Crise",
  "round:6": "Rodada 6 · Festival",
};

const CONNECTION_LABELS = {
  connected: "Atualização ao vivo",
  offline: "Board desconectado",
  reconnecting: "Reconectando ao board",
} as const;

function HomeComponent() {
  const state = useQuery(orpc.board.state.queryOptions());
  const connectionStatus = useBoardConnectionStatus();

  if (state.isLoading) {
    return (
      <main className="loading-sheet">
        <Skeleton className="h-[68vh] w-full" />
      </main>
    );
  }

  if (state.isError || !state.data) {
    return (
      <main className="loading-sheet">
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>O livro de campo não abriu</AlertTitle>
          <AlertDescription>
            Confirme que o board está rodando na porta 3001 e recarregue a
            página.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const { config, events, rounds, squads } = state.data;
  const activeRound = rounds.find(
    (round) => `round:${round.number}` === config.currentPhase
  );

  return (
    <main className="board-shell">
      <aside aria-label="Squads" className="squad-book">
        <header className="book-heading">
          <p>Livro de campo</p>
          <h1>Equipes</h1>
        </header>
        <ol className="squad-list">
          {squads.map((squad) => (
            <li key={squad.id}>
              <div className="squad-title-row">
                <h2>
                  <Link params={{ id: squad.id }} to="/squad/$id">
                    {String(squad.ordinal).padStart(2, "0")} · {squad.name}
                  </Link>
                </h2>
                <Badge variant="outline">{squad.members.length}</Badge>
              </div>
              {squad.members.length > 0 ? (
                <ul className="member-list">
                  {squad.members.map((member) => (
                    <li key={member.id}>
                      <UserRoundIcon aria-hidden="true" />
                      {member.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-line">Aguardando participantes</p>
              )}
            </li>
          ))}
        </ol>
        <Link
          className={cn(buttonVariants({ variant: "outline" }), "join-link")}
          to="/me"
        >
          Escolher meu squad
        </Link>
      </aside>

      <section aria-labelledby="city-title" className="city-sheet">
        <header className="plan-heading">
          <div>
            <p>Planta cadastral</p>
            <h2 id="city-title">{config.theme}</h2>
          </div>
          <dl>
            <div>
              <dt>Escala</dt>
              <dd>1:1000</dd>
            </div>
            <div>
              <dt>Revisão</dt>
              <dd>{state.data.revision}</dd>
            </div>
          </dl>
        </header>
        <div className="parcel-map">
          <svg
            aria-hidden="true"
            className="survey-lines"
            viewBox="0 0 1000 640"
          >
            <path d="M20 76 L982 28 M5 534 L988 591 M152 8 L88 632 M838 4 L914 634" />
            <path d="M0 310 C210 278 345 350 530 318 S807 244 1000 292" />
          </svg>
          <div className="parcel-grid">
            {squads.map((squad) => (
              <article className="parcel" key={squad.id}>
                <div className="parcel-number">
                  {String(squad.ordinal).padStart(2, "0")}
                </div>
                <div className="parcel-copy">
                  <h3>
                    <Link params={{ id: squad.id }} to="/squad/$id">
                      {squad.name}
                    </Link>
                  </h3>
                  <p>
                    {squad.members.length === 0
                      ? "Lote disponível"
                      : `${squad.members.length} pessoa${squad.members.length === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div aria-hidden="true" className="lot-plan">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <Badge
                  variant={squad.members.length > 0 ? "default" : "outline"}
                >
                  {squad.members.length > 0 ? "Ocupado" : "Em formação"}
                </Badge>
              </article>
            ))}
          </div>
        </div>
      </section>

      <aside aria-label="Fase atual" className="phase-margin">
        <section>
          <p>Fase atual</p>
          <h2>{PHASE_LABELS[config.currentPhase] ?? config.currentPhase}</h2>
          {activeRound ? (
            <Badge variant="secondary">
              {activeRound.skippable ? "Pode pular" : "Obrigatória"}
            </Badge>
          ) : null}
        </section>
        <section className="room-register">
          <p>Sala</p>
          <strong>GAMBI · LOCAL</strong>
          <output
            aria-live="polite"
            className="connection-status"
            data-status={connectionStatus}
          >
            <RadioIcon aria-hidden="true" />
            {CONNECTION_LABELS[connectionStatus]}
          </output>
        </section>
        <section>
          <p>Configuração</p>
          <dl className="phase-data">
            <div>
              <dt>Squads</dt>
              <dd>{config.squadCount}</dd>
            </div>
            <div>
              <dt>Harnesses hospedados</dt>
              <dd>{config.hostedHarnessCount}</dd>
            </div>
          </dl>
        </section>
        <Link className={cn(buttonVariants(), "admin-link")} to="/admin">
          Abrir controle do admin
        </Link>
      </aside>

      <section aria-labelledby="ledger-title" className="event-ledger">
        <header>
          <h2 id="ledger-title">Diário de campo · registros do board</h2>
          <Badge variant="outline">{events.length} recentes</Badge>
        </header>
        {events.length === 0 ? (
          <Empty className="ledger-empty">
            <EmptyHeader>
              <EmptyTitle>O primeiro registro ainda não foi feito</EmptyTitle>
              <EmptyDescription>
                Entradas, trocas de squad e mudanças de fase aparecem aqui.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="ledger-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seq.</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Horário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.sequence}>
                      <TableCell>
                        {String(event.sequence).padStart(3, "0")}
                      </TableCell>
                      <TableCell>{event.type}</TableCell>
                      <TableCell>{event.actorName ?? "Admin"}</TableCell>
                      <TableCell>
                        {new Date(event.createdAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ol className="ledger-mobile">
              {events.map((event) => (
                <li key={event.sequence}>
                  <span>Seq.</span>
                  <strong>{String(event.sequence).padStart(3, "0")}</strong>
                  <span>Registro</span>
                  <strong>{event.type}</strong>
                  <span>Autor</span>
                  <strong>{event.actorName ?? "Admin"}</strong>
                  <span>Horário</span>
                  <strong>
                    {new Date(event.createdAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
