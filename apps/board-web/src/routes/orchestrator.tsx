import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, CircleHelpIcon, SendIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { getPersonId } from "@/lib/identity";
import { client, orpc, queryClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorPage,
});

function OrchestratorPage() {
  const workflow = useQuery(orpc.workflow.get.queryOptions({ input: {} }));
  const state = useQuery(orpc.board.state.queryOptions());
  const personId = useMemo(() => getPersonId(), []);
  const [objective, setObjective] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const isSteerer = workflow.data?.orchestratorSteerer?.personId === personId;

  async function run(action: () => Promise<unknown>, message: string) {
    setPending(true);
    try {
      await action();
      await queryClient.invalidateQueries();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A ação falhou.");
    } finally {
      setPending(false);
    }
  }

  if (workflow.isPending) {
    return (
      <main className="interior-page">Carregando caderno da rodada...</main>
    );
  }
  if (!workflow.data) {
    return (
      <main className="interior-page">
        Não foi possível abrir o caderno da rodada.
      </main>
    );
  }
  if (!isSteerer) {
    return (
      <main className="interior-page narrow-page">
        <Alert>
          <CircleHelpIcon aria-hidden="true" />
          <AlertTitle>Mesa reservada ao steerer</AlertTitle>
          <AlertDescription>
            {workflow.data?.orchestratorSteerer
              ? `${workflow.data.orchestratorSteerer.personName} conduz o orquestrador nesta rodada.`
              : "O admin ainda precisa registrar quem conduz o orquestrador."}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const pendingEscalations = workflow.data.escalations.filter(
    (item) => item.status === "pending"
  );
  return (
    <main className="interior-page orchestrator-page">
      <header className="interior-heading">
        <Link
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "back-link"
          )}
          to="/"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Voltar à cidade
        </Link>
        <Badge variant="outline">{workflow.data.roundId}</Badge>
        <h1>Mesa do orquestrador</h1>
        <p>
          Defina o objetivo comum, revise um desafio por squad e só então envie
          a rodada.
        </p>
      </header>

      <section className="objective-slip">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="round-objective">
              Objetivo da rodada
            </FieldLabel>
            <Textarea
              id="round-objective"
              onChange={(event) => setObjective(event.target.value)}
              placeholder="O que a cidade precisa conseguir nesta rodada?"
              value={objective}
            />
            <FieldDescription>
              O modelo da sala combina este objetivo com os dados semeados da
              rodada.
            </FieldDescription>
          </Field>
          <Button
            disabled={pending || !objective.trim()}
            onClick={() =>
              run(
                () =>
                  client.orchestrator.propose({
                    actorPersonId: personId,
                    objective,
                  }),
                "Desafios propostos para revisão."
              )
            }
            type="button"
          >
            Propor desafios
          </Button>
        </FieldGroup>
      </section>

      <div className="challenge-register">
        {workflow.data.challenges.map((challenge) => {
          const squad = state.data?.squads.find(
            (item) => item.id === challenge.squadId
          );
          const value = edits[challenge.id] ?? challenge.objective;
          return (
            <Card key={challenge.id}>
              <CardHeader>
                <CardTitle>{squad?.name ?? challenge.squadId}</CardTitle>
                <CardDescription>
                  {challenge.drafts.length} propostas semeadas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-disabled={challenge.status !== "draft"}>
                    <FieldLabel htmlFor={`challenge-${challenge.id}`}>
                      Desafio
                    </FieldLabel>
                    <Textarea
                      disabled={challenge.status !== "draft"}
                      id={`challenge-${challenge.id}`}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [challenge.id]: event.target.value,
                        }))
                      }
                      value={value}
                    />
                  </Field>
                  <Button
                    disabled={
                      pending || challenge.status !== "draft" || !value.trim()
                    }
                    onClick={() =>
                      run(
                        () =>
                          client.orchestrator.editChallenge({
                            actorPersonId: personId,
                            challengeId: challenge.id,
                            objective: value,
                          }),
                        "Desafio atualizado."
                      )
                    }
                    type="button"
                    variant="outline"
                  >
                    Salvar edição
                  </Button>
                </FieldGroup>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button
        className="publish-round"
        disabled={
          pending ||
          workflow.data.challenges.every((item) => item.status !== "draft")
        }
        onClick={() =>
          run(
            () => client.orchestrator.publish({ actorPersonId: personId }),
            "Desafios enviados aos squads."
          )
        }
        type="button"
      >
        <SendIcon data-icon="inline-start" />
        Enviar rodada aos squads
      </Button>

      <section className="escalation-ledger">
        <header>
          <h2>Pendências humanas</h2>
          <Badge
            variant={pendingEscalations.length ? "destructive" : "outline"}
          >
            {pendingEscalations.length}
          </Badge>
        </header>
        {pendingEscalations.length === 0 ? (
          <p>Nenhuma devolução precisa de arbitragem.</p>
        ) : (
          pendingEscalations.map((escalation) => (
            <Card key={escalation.id}>
              <CardHeader>
                <CardTitle>{escalation.question}</CardTitle>
                <CardDescription>{escalation.reason}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`answer-${escalation.id}`}>
                      Decisão humana
                    </FieldLabel>
                    <Textarea
                      id={`answer-${escalation.id}`}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [escalation.id]: event.target.value,
                        }))
                      }
                      value={answers[escalation.id] ?? ""}
                    />
                  </Field>
                  <Button
                    disabled={pending || !answers[escalation.id]?.trim()}
                    onClick={() =>
                      run(
                        () =>
                          client.orchestrator.answerEscalation({
                            actorPersonId: personId,
                            escalationId: escalation.id,
                            response: answers[escalation.id] ?? "",
                          }),
                        "Pendência respondida."
                      )
                    }
                    type="button"
                  >
                    Registrar resposta
                  </Button>
                </FieldGroup>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </main>
  );
}
