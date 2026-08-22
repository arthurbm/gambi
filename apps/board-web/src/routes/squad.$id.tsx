// biome-ignore-all lint/style/useFilenamingConvention: TanStack Router encodes dynamic segments with a dollar sign.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BotIcon,
  FileCodeIcon,
  SendIcon,
  TerminalSquareIcon,
  UserRoundIcon,
  WrenchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RoundWorkflow } from "@/components/round-workflow";
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
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPersonId } from "@/lib/identity";
import { client, orpc, queryClient } from "@/lib/orpc";
import { useHarnessStream } from "@/lib/sse";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/squad/$id")({ component: SquadPage });

function describeEvent(event: ReturnType<typeof useHarnessStream>[number]) {
  if (event.event.type === "text") {
    return event.event.text ?? "Texto recebido";
  }
  if (event.event.type === "tool-call") {
    return `Ferramenta: ${event.event.toolName ?? "sem nome"}`;
  }
  if (event.event.type === "file") {
    return `Arquivo tocado: ${event.event.path ?? "sem caminho"}`;
  }
  if (event.event.type === "artifact") {
    return `Artifact: ${event.event.files?.map((file) => file.path).join(", ") ?? "sem arquivos"}`;
  }
  if (event.event.type === "error") {
    return event.event.message ?? "Erro no harness";
  }
  return `Sessão ${event.event.status ?? event.event.type}`;
}

function EventIcon({ type }: { type: string }) {
  if (type === "tool-call") {
    return <WrenchIcon aria-hidden="true" />;
  }
  if (type === "file" || type === "artifact") {
    return <FileCodeIcon aria-hidden="true" />;
  }
  return <TerminalSquareIcon aria-hidden="true" />;
}

function SquadPage() {
  const { id: squadId } = Route.useParams();
  const state = useQuery(orpc.board.state.queryOptions());
  const harnessState = useQuery(
    orpc.harnesses.squad.queryOptions({ input: { squadId } })
  );
  const stream = useHarnessStream(squadId);
  const personId = useMemo(() => getPersonId(), []);
  const [selectedHarness, setSelectedHarness] = useState("");
  const [selectedSteerer, setSelectedSteerer] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const squad = state.data?.squads.find((item) => item.id === squadId);
  const actorIsMember = squad?.members.some((member) => member.id === personId);
  const squadHarnesses =
    state.data?.harnesses.filter((harness) =>
      squad?.members.some((member) => member.id === harness.ownerPersonId)
    ) ?? [];
  const isSteerer = harnessState.data?.steerer?.personId === personId;

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await action();
      await queryClient.invalidateQueries();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A ação falhou.");
    } finally {
      setPending(false);
    }
  }

  if (!squad) {
    return (
      <main className="interior-page">
        <h1>Squad não encontrado</h1>
        <Link to="/">Voltar à cidade</Link>
      </main>
    );
  }

  return (
    <main className="interior-page squad-page">
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
        <Badge variant="outline">
          {harnessState.data?.roundId ?? "sem rodada"}
        </Badge>
        <h1>{squad.name}</h1>
        <p>
          O squad acompanha o mesmo stream. A pessoa eleita como steerer escreve
          no harness nesta rodada.
        </p>
      </header>

      <RoundWorkflow
        actorIsMember={Boolean(actorIsMember)}
        isSteerer={isSteerer}
        personId={personId}
        squadId={squadId}
      />

      <div className="squad-workbench">
        <Card>
          <CardHeader>
            <CardTitle>Designação da rodada</CardTitle>
            <CardDescription>
              Harness e steerer ficam registrados com nomes no diário.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-disabled={!actorIsMember}>
                <FieldTitle id="assignment-label">Harness do squad</FieldTitle>
                <ToggleGroup
                  aria-labelledby="assignment-label"
                  disabled={!actorIsMember}
                  onValueChange={(values) =>
                    setSelectedHarness(values[0] ?? "")
                  }
                  orientation="vertical"
                  value={[
                    selectedHarness ||
                      harnessState.data?.assignment?.participantId ||
                      "",
                  ]}
                  variant="outline"
                >
                  {squadHarnesses.map((harness) => (
                    <ToggleGroupItem
                      key={harness.participantId}
                      value={harness.participantId}
                    >
                      <BotIcon aria-hidden="true" />
                      {harness.nickname}
                      <Badge
                        variant={harness.connected ? "default" : "outline"}
                      >
                        {harness.connected ? "Conectado" : "Offline"}
                      </Badge>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>
                  Só aparecem harnesses reivindicados por alguém deste squad.
                </FieldDescription>
              </Field>
              <Button
                disabled={!(actorIsMember && selectedHarness) || pending}
                onClick={() =>
                  run(
                    () =>
                      client.harnesses.assign({
                        actorPersonId: personId,
                        squadId,
                        participantId: selectedHarness,
                      }),
                    "Harness designado para a rodada."
                  )
                }
                type="button"
              >
                Designar harness
              </Button>
              <Field data-disabled={!actorIsMember}>
                <FieldTitle id="steerer-label">Steerer da rodada</FieldTitle>
                <ToggleGroup
                  aria-labelledby="steerer-label"
                  disabled={!actorIsMember}
                  onValueChange={(values) =>
                    setSelectedSteerer(values[0] ?? "")
                  }
                  orientation="vertical"
                  value={[
                    selectedSteerer ||
                      harnessState.data?.steerer?.personId ||
                      "",
                  ]}
                  variant="outline"
                >
                  {squad.members.map((member) => (
                    <ToggleGroupItem key={member.id} value={member.id}>
                      <UserRoundIcon aria-hidden="true" />
                      {member.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Button
                disabled={!(actorIsMember && selectedSteerer) || pending}
                onClick={() =>
                  run(
                    () =>
                      client.harnesses.electSteerer({
                        actorPersonId: personId,
                        squadId,
                        personId: selectedSteerer,
                      }),
                    "Steerer registrado para a rodada."
                  )
                }
                type="button"
                variant="outline"
              >
                Registrar steerer
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="harness-console">
          <CardHeader>
            <CardTitle>Canal do harness</CardTitle>
            <CardDescription>
              {harnessState.data?.steerer
                ? `${harnessState.data.steerer.personName} conduz esta rodada.`
                : "Eleja uma pessoa antes de começar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol aria-live="polite" className="stream-ledger">
              {stream.length === 0 ? (
                <li className="stream-empty">Aguardando atividade ACP.</li>
              ) : (
                stream.map((event) => (
                  <li key={event.key}>
                    <EventIcon type={event.event.type} />
                    <div>
                      <span>{event.event.type}</span>
                      <p>{describeEvent(event)}</p>
                    </div>
                  </li>
                ))
              )}
            </ol>
            <FieldGroup>
              <Field data-disabled={!isSteerer}>
                <FieldLabel htmlFor="harness-prompt">
                  Prompt adicional
                </FieldLabel>
                <Input
                  disabled={!isSteerer || pending}
                  id="harness-prompt"
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={
                    isSteerer
                      ? "Corrija o rumo na mesma sessão"
                      : `Somente ${harnessState.data?.steerer?.personName ?? "o steerer"} pode escrever`
                  }
                  value={prompt}
                />
                <FieldDescription>
                  {isSteerer
                    ? "O board confirma a eleição no servidor antes de entregar."
                    : "Você acompanha o mesmo stream em tempo real."}
                </FieldDescription>
              </Field>
              <Button
                disabled={!(isSteerer && prompt.trim()) || pending}
                onClick={() =>
                  run(async () => {
                    await client.harnesses.prompt({
                      actorPersonId: personId,
                      squadId,
                      prompt,
                    });
                    setPrompt("");
                  }, "Prompt entregue ao harness.")
                }
                type="button"
              >
                <SendIcon data-icon="inline-start" />
                Enviar ao harness
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
