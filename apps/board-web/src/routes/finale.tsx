import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { CityMap } from "@/features/city/city-map";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/finale")({
  component: FinalePage,
});

function FinalePage() {
  const finale = useQuery(orpc.workflow.finale.queryOptions());
  const state = useQuery(orpc.board.state.queryOptions());

  if (finale.isPending || state.isPending) {
    return <main className="interior-page">Abrindo o registro final...</main>;
  }
  if (!(finale.data && state.data)) {
    return (
      <main className="interior-page">
        Não foi possível abrir o registro final.
      </main>
    );
  }

  return (
    <main className="finale-page">
      <header className="finale-heading">
        <div>
          <p>Registro de encerramento</p>
          <h1>Cidade das inteligências mistas</h1>
        </div>
        <dl>
          <div>
            <dt>Drafts de pessoas</dt>
            <dd>{finale.data.totals.drafts.human}</dd>
          </div>
          <div>
            <dt>Drafts de harnesses</dt>
            <dd>{finale.data.totals.drafts.harness}</dd>
          </div>
          <div>
            <dt>Devoluções</dt>
            <dd>{finale.data.totals.returnedReviews}</dd>
          </div>
        </dl>
      </header>

      <CityMap
        revision={state.data.revision}
        showMetro
        squads={state.data.squads}
        theme={state.data.config.theme}
        tiles={state.data.tiles}
      />

      <section aria-labelledby="finale-ledger-title" className="finale-ledger">
        <header>
          <p>Caderno consolidado</p>
          <h2 id="finale-ledger-title">Decisões por squad</h2>
          {finale.data.orchestratorModel ? (
            <Badge variant="outline">
              Modelo final: {finale.data.orchestratorModel.modelLabel}
            </Badge>
          ) : null}
        </header>
        <div className="finale-squads">
          {finale.data.squads.map((squad) => (
            <Card key={squad.id}>
              <CardHeader>
                <CardTitle>
                  {String(squad.ordinal).padStart(2, "0")} · {squad.name}
                </CardTitle>
                <CardDescription>
                  {squad.draftCounts.human} humanos ·{" "}
                  {squad.draftCounts.harness} harnesses ·{" "}
                  {squad.returnedReviews} devoluções
                </CardDescription>
              </CardHeader>
              <CardContent>
                {squad.decisions.length ? (
                  <ol className="finale-decisions">
                    {squad.decisions.map((decision) => (
                      <li key={decision.id}>
                        <Badge variant="outline">
                          Rodada {decision.roundNumber}
                        </Badge>
                        <h3>{decision.build}</h3>
                        <p>{decision.reason}</p>
                        <small>
                          Corte: {decision.cut} · steerer {decision.steererName}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Nenhuma decisão registrada</EmptyTitle>
                      <EmptyDescription>
                        O lote segue no mapa, mesmo sem uma decisão concluída.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
