import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { client, orpc, queryClient } from "@/lib/orpc";

interface RoundWorkflowProps {
  actorIsMember: boolean;
  isSteerer: boolean;
  personId: string;
  squadId: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the workbench keeps one shared draft and decision state across the four gated steps.
export function RoundWorkflow({
  actorIsMember,
  isSteerer,
  personId,
  squadId,
}: RoundWorkflowProps) {
  const workflow = useQuery(orpc.workflow.get.queryOptions({ input: {} }));
  const [draft, setDraft] = useState("");
  const [harnessRequest, setHarnessRequest] = useState("");
  const [build, setBuild] = useState("");
  const [cut, setCut] = useState("");
  const [reason, setReason] = useState("");
  const [considered, setConsidered] = useState<string[]>([]);
  const [expectedOutput, setExpectedOutput] = useState(
    "Lote funcional em HTML, CSS e JavaScript"
  );
  const [constraints, setConstraints] = useState(
    "Preservar os arquivos iniciais\nManter o lote navegável por teclado"
  );
  const [reviewReason, setReviewReason] = useState("");
  const [pending, setPending] = useState(false);
  const challenge = workflow.data?.challenges.find(
    (item) => item.squadId === squadId
  );

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

  if (!challenge) {
    return null;
  }
  const lastReview = challenge.dispatch?.reviews.at(-1);
  const decided = Boolean(challenge.decision);

  return (
    <section className="round-workflow">
      <header className="workflow-heading">
        <div>
          <Badge
            variant={challenge.status === "published" ? "default" : "outline"}
          >
            {workflow.data?.roundId}
          </Badge>
          <h2>Registro da rodada</h2>
        </div>
        <p>
          {challenge.status === "published"
            ? challenge.objective
            : "O orquestrador ainda está preparando este desafio."}
        </p>
      </header>

      <div className="proposal-ledger">
        {challenge.drafts.map((item) => (
          <article className="proposal-slip" key={item.id}>
            <div>
              <Badge variant="outline">
                {item.seeded ? "semeado" : item.origin}
              </Badge>
              <strong>{item.authorName}</strong>
            </div>
            <p>{item.content}</p>
            {isSteerer ? (
              <Button
                onClick={() => {
                  setBuild(item.content);
                  setConsidered((current) =>
                    current.includes(item.id) ? current : [...current, item.id]
                  );
                  toast.success("Draft copiado para a decisão.");
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <CopyIcon data-icon="inline-start" />
                Usar
              </Button>
            ) : null}
          </article>
        ))}
      </div>

      <div className="workflow-columns">
        <Card>
          <CardHeader>
            <CardTitle>Drafts do squad</CardTitle>
            <CardDescription>
              Qualquer membro pode registrar uma ideia ou consultar seu próprio
              harness.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-disabled={!actorIsMember}>
                <FieldLabel htmlFor="manual-draft">Draft manual</FieldLabel>
                <Textarea
                  disabled={!actorIsMember || pending}
                  id="manual-draft"
                  onChange={(event) => setDraft(event.target.value)}
                  value={draft}
                />
              </Field>
              <Button
                disabled={!actorIsMember || pending || !draft.trim()}
                onClick={() =>
                  run(async () => {
                    await client.drafts.create({
                      actorPersonId: personId,
                      challengeId: challenge.id,
                      content: draft,
                    });
                    setDraft("");
                  }, "Draft registrado.")
                }
                type="button"
              >
                Registrar draft
              </Button>
              <Field data-disabled={!actorIsMember}>
                <FieldLabel htmlFor="harness-draft">
                  Pedir ao meu harness
                </FieldLabel>
                <Textarea
                  disabled={!actorIsMember || pending}
                  id="harness-draft"
                  onChange={(event) => setHarnessRequest(event.target.value)}
                  placeholder="Que alternativa seu harness deve explorar?"
                  value={harnessRequest}
                />
              </Field>
              <Button
                disabled={!actorIsMember || pending || !harnessRequest.trim()}
                onClick={() =>
                  run(async () => {
                    await client.drafts.requestFromHarness({
                      actorPersonId: personId,
                      challengeId: challenge.id,
                      request: harnessRequest,
                    });
                    setHarnessRequest("");
                  }, "Pedido entregue e draft registrado.")
                }
                type="button"
                variant="outline"
              >
                <SparklesIcon data-icon="inline-start" />
                Pedir ao meu harness
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="decision-interview">
          <CardHeader>
            <CardTitle>Decisão em quatro respostas</CardTitle>
            <CardDescription>
              {isSteerer
                ? "A decisão libera o dispatch e fica registrada com seu nome."
                : "Somente o steerer responde. Todos acompanham o registro."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-disabled={!isSteerer}>
                <FieldLabel htmlFor="decision-build">
                  1. O que fazemos?
                </FieldLabel>
                <Textarea
                  disabled={
                    !isSteerer || pending || Boolean(challenge.dispatch)
                  }
                  id="decision-build"
                  onChange={(event) => setBuild(event.target.value)}
                  value={challenge.decision?.build ?? build}
                />
              </Field>
              <Field data-disabled={!isSteerer}>
                <FieldLabel htmlFor="decision-cut">
                  2. O que cortamos?
                </FieldLabel>
                <Textarea
                  disabled={
                    !isSteerer || pending || Boolean(challenge.dispatch)
                  }
                  id="decision-cut"
                  onChange={(event) => setCut(event.target.value)}
                  value={challenge.decision?.cut ?? cut}
                />
              </Field>
              <Field data-disabled={!isSteerer}>
                <FieldLabel htmlFor="decision-reason">3. Por quê?</FieldLabel>
                <Textarea
                  disabled={
                    !isSteerer || pending || Boolean(challenge.dispatch)
                  }
                  id="decision-reason"
                  onChange={(event) => setReason(event.target.value)}
                  value={challenge.decision?.reason ?? reason}
                />
              </Field>
              <Field data-disabled={!isSteerer}>
                <FieldLabel>4. Quais drafts foram considerados?</FieldLabel>
                <div className="draft-checklist">
                  {challenge.drafts.map((item) => (
                    <label htmlFor={`considered-${item.id}`} key={item.id}>
                      <Checkbox
                        checked={(
                          challenge.decision?.consideredDraftIds ?? considered
                        ).includes(item.id)}
                        disabled={
                          !isSteerer || pending || Boolean(challenge.dispatch)
                        }
                        id={`considered-${item.id}`}
                        onCheckedChange={(checked) =>
                          setConsidered((current) =>
                            checked
                              ? [...new Set([...current, item.id])]
                              : current.filter((id) => id !== item.id)
                          )
                        }
                      />
                      <span>{item.content}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Button
                disabled={
                  !isSteerer ||
                  pending ||
                  Boolean(challenge.dispatch) ||
                  !(
                    build.trim() &&
                    cut.trim() &&
                    reason.trim() &&
                    considered.length
                  )
                }
                onClick={() =>
                  run(
                    () =>
                      client.decisions.record({
                        actorPersonId: personId,
                        challengeId: challenge.id,
                        build,
                        cut,
                        reason,
                        consideredDraftIds: considered,
                      }),
                    "Decisão registrada com quatro respostas."
                  )
                }
                type="button"
              >
                <CheckIcon data-icon="inline-start" />
                Gravar decisão
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <Card className="dispatch-slip">
        <CardHeader>
          <CardTitle>Ordem de serviço</CardTitle>
          <CardDescription>
            {challenge.dispatch
              ? `Sessão ${challenge.dispatch.sessionId} · ${challenge.dispatch.status}`
              : "O payload tipado só sai depois da decisão."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {challenge.dispatch ? (
            <FieldGroup>
              <Field data-disabled={!isSteerer}>
                <FieldLabel htmlFor="review-reason">
                  Motivo da revisão
                </FieldLabel>
                <Textarea
                  disabled={
                    !isSteerer || pending || lastReview?.outcome === "accepted"
                  }
                  id="review-reason"
                  onChange={(event) => setReviewReason(event.target.value)}
                  placeholder="Obrigatório para devolver"
                  value={reviewReason}
                />
                <FieldDescription>
                  {lastReview
                    ? `Última revisão: ${lastReview.outcome} por ${lastReview.reviewerName}.`
                    : "Aceite ou devolva. A devolução volta à mesma sessão."}
                </FieldDescription>
              </Field>
              <div className="review-actions">
                <Button
                  disabled={
                    !isSteerer || pending || lastReview?.outcome === "accepted"
                  }
                  onClick={() =>
                    run(
                      () =>
                        client.reviews.record({
                          actorPersonId: personId,
                          dispatchId: challenge.dispatch?.id ?? "",
                          outcome: "accepted",
                          reason: reviewReason || undefined,
                        }),
                      "Trabalho aceito."
                    )
                  }
                  type="button"
                >
                  <CheckIcon data-icon="inline-start" />
                  Aceitar
                </Button>
                <Button
                  disabled={
                    !isSteerer ||
                    pending ||
                    !reviewReason.trim() ||
                    lastReview?.outcome === "accepted"
                  }
                  onClick={() =>
                    run(async () => {
                      const result = await client.reviews.record({
                        actorPersonId: personId,
                        dispatchId: challenge.dispatch?.id ?? "",
                        outcome: "returned",
                        reason: reviewReason,
                      });
                      setReviewReason("");
                      if (result.escalationId) {
                        toast.info(
                          "O limite de devoluções abriu uma pendência no orquestrador."
                        );
                      }
                    }, "Devolução registrada.")
                  }
                  type="button"
                  variant="destructive"
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Devolver com motivo
                </Button>
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup>
              <Field data-disabled={!(isSteerer && decided)}>
                <FieldLabel htmlFor="expected-output">
                  Saída esperada
                </FieldLabel>
                <Input
                  disabled={!(isSteerer && decided) || pending}
                  id="expected-output"
                  onChange={(event) => setExpectedOutput(event.target.value)}
                  value={expectedOutput}
                />
              </Field>
              <Field data-disabled={!(isSteerer && decided)}>
                <FieldLabel htmlFor="constraints">
                  Restrições, uma por linha
                </FieldLabel>
                <Textarea
                  disabled={!(isSteerer && decided) || pending}
                  id="constraints"
                  onChange={(event) => setConstraints(event.target.value)}
                  value={constraints}
                />
              </Field>
              <Button
                disabled={
                  !(isSteerer && decided) || pending || !expectedOutput.trim()
                }
                onClick={() =>
                  run(
                    () =>
                      client.dispatches.send({
                        actorPersonId: personId,
                        challengeId: challenge.id,
                        expectedOutput,
                        constraints: constraints
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }),
                    "Dispatch entregue ao harness."
                  )
                }
                type="button"
              >
                <SendIcon data-icon="inline-start" />
                Enviar dispatch
              </Button>
            </FieldGroup>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
