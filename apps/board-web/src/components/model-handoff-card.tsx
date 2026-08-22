import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client, orpc } from "@/lib/orpc";

interface HandoffSummary {
  squads?: Array<{ id?: string; name?: string }>;
  decisions?: Array<{ squadId?: string; roundId?: string; build?: string }>;
  pending?: Array<{
    squadId?: string;
    roundId?: string;
    hasDecision?: boolean;
  }>;
}

type Workflow = Awaited<ReturnType<typeof client.workflow.get>>;

function parseHandoff(value: string): HandoffSummary | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as HandoffSummary)
      : null;
  } catch {
    return null;
  }
}

export function ModelHandoffCard({
  currentModel,
  pending,
  personId,
  run,
}: {
  currentModel: Workflow["orchestratorModel"];
  pending: boolean;
  personId: string;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const models = useQuery(orpc.orchestrator.models.queryOptions());
  const [selectedModel, setSelectedModel] = useState("");
  const handoff = currentModel ? parseHandoff(currentModel.handoff) : null;

  return (
    <Card className="model-handoff">
      <CardHeader>
        <CardTitle>Troca de modelo</CardTitle>
        <CardDescription>
          {currentModel
            ? `${currentModel.modelLabel} assumiu de ${currentModel.previousModelLabel}.`
            : "Escolha outro modelo da sala para conduzir o festival."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="orchestrator-model">Novo modelo</FieldLabel>
            <Select
              onValueChange={(value) => setSelectedModel(value ?? "")}
              value={selectedModel}
            >
              <SelectTrigger className="w-full" id="orchestrator-model">
                <SelectValue placeholder="Selecione um modelo da sala" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(models.data ?? []).map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.nickname} · {model.model}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Harnesses não aparecem aqui. A lista vem do inference plane da
              sala.
            </FieldDescription>
          </Field>
          <Button
            disabled={
              pending ||
              !selectedModel ||
              selectedModel === currentModel?.participantId
            }
            onClick={() =>
              run(async () => {
                await client.orchestrator.swapModel({
                  actorPersonId: personId,
                  participantId: selectedModel,
                });
                setSelectedModel("");
              }, "Modelo trocado com handoff registrado.")
            }
            type="button"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            Trocar modelo
          </Button>
        </FieldGroup>

        {currentModel ? (
          <section aria-labelledby="handoff-title" className="handoff-slip">
            <h3 id="handoff-title">Resumo entregue</h3>
            {handoff ? (
              <>
                <dl>
                  <div>
                    <dt>Squads</dt>
                    <dd>{handoff.squads?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Decisões</dt>
                    <dd>{handoff.decisions?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Trabalhos pendentes</dt>
                    <dd>{handoff.pending?.length ?? 0}</dd>
                  </div>
                </dl>
                <div className="handoff-details">
                  <section>
                    <h4>Squads</h4>
                    <p>
                      {handoff.squads
                        ?.map((squad) => squad.name ?? squad.id)
                        .filter(Boolean)
                        .join(", ") || "Nenhum squad registrado"}
                    </p>
                  </section>
                  <section>
                    <h4>Decisões anteriores</h4>
                    {handoff.decisions?.length ? (
                      <ul>
                        {handoff.decisions.map((decision, index) => (
                          <li
                            key={`${decision.squadId}:${decision.roundId}:${index}`}
                          >
                            {decision.squadId} · {decision.roundId}:{" "}
                            {decision.build}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Nenhuma decisão registrada.</p>
                    )}
                  </section>
                  <section>
                    <h4>Trabalho pendente</h4>
                    {handoff.pending?.length ? (
                      <ul>
                        {handoff.pending.map((item, index) => (
                          <li key={`${item.squadId}:${item.roundId}:${index}`}>
                            {item.squadId} · {item.roundId}
                            {item.hasDecision
                              ? " · decisão pronta"
                              : " · sem decisão"}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Nenhuma pendência.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <pre>{currentModel.handoff}</pre>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
