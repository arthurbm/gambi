import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  ClipboardIcon,
  MapPinIcon,
  PlugZapIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { getPersonId, getStoredName, storeName } from "@/lib/identity";
import { client, orpc, queryClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/me")({ component: MePage });

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function MePage() {
  const fakeHarnessEnabled =
    import.meta.env.VITE_BOARD_ENABLE_FAKE_HARNESS === "1";
  const state = useQuery(orpc.board.state.queryOptions());
  const personId = useMemo(() => getPersonId(), []);
  const [name, setName] = useState(getStoredName);
  const [savedName, setSavedName] = useState(getStoredName);
  const currentSquad = state.data?.squads.find((squad) =>
    squad.members.some((member) => member.id === personId)
  );
  const [selectedSquad, setSelectedSquad] = useState("");
  const [pending, setPending] = useState(false);
  const [harnessId, setHarnessId] = useState("opencode");
  const personalParticipantId = `board-person-${personId}`;
  const personalHarness = state.data?.harnesses.find(
    (harness) => harness.participantId === personalParticipantId
  );
  useEffect(() => {
    if (personalHarness?.harnessId === "fake" && fakeHarnessEnabled) {
      setHarnessId("fake");
    }
  }, [personalHarness?.harnessId]);
  const ownedHarness = state.data?.harnesses.find(
    (harness) => harness.ownerPersonId === personId
  );
  const availableHosted =
    state.data?.harnesses.filter(
      (harness) => harness.hosted && !harness.ownerPersonId
    ) ?? [];
  const roomCode = state.data?.config.roomCode;
  const joinCommand = roomCode
    ? `gambi join --room ${roomCode} --participant-id ${personalParticipantId} --nickname ${shellQuote(savedName || "Seu nome")} --harness ${harnessId}`
    : "Configure GAMBI_ROOM_CODE no servidor do board.";

  async function saveIdentity(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await client.people.join({ personId, name });
      storeName(result.name);
      setName(result.name);
      setSavedName(result.name);
      await queryClient.invalidateQueries();
      toast.success("Nome registrado no livro de campo.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar seu nome."
      );
    } finally {
      setPending(false);
    }
  }

  async function joinSquad() {
    if (!selectedSquad) {
      return;
    }
    setPending(true);
    try {
      await client.squads.join({ personId, squadId: selectedSquad });
      await queryClient.invalidateQueries();
      toast.success("Squad atualizado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível entrar no squad."
      );
    } finally {
      setPending(false);
    }
  }

  async function claimHosted(participantId: string) {
    setPending(true);
    try {
      await client.harnesses.claimHosted({ personId, participantId });
      await queryClient.invalidateQueries();
      toast.success("Harness hospedado registrado no seu nome.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível reivindicar."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="interior-page">
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
        <h1>Meu registro</h1>
        <p>
          Seu nome fica neste navegador. O squad acompanha a pessoa, não o
          aparelho.
        </p>
      </header>

      <div className="form-ledger">
        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
            <CardDescription>
              Use o nome pelo qual a sala vai reconhecer você.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveIdentity}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="person-name">Nome</FieldLabel>
                  <Input
                    aria-invalid={name.trim().length === 0}
                    autoComplete="name"
                    id="person-name"
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Como devemos chamar você?"
                    value={name}
                  />
                  <FieldDescription>
                    Obrigatório. Você pode atualizar depois.
                  </FieldDescription>
                </Field>
                <Button
                  disabled={pending || name.trim().length === 0}
                  type="submit"
                >
                  <UserRoundIcon data-icon="inline-start" />
                  {pending ? "Registrando..." : "Registrar meu nome"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Escolha de squad</CardTitle>
            <CardDescription>
              {currentSquad
                ? `Você está em ${currentSquad.name}.`
                : "Escolha um lote para trabalhar com a equipe."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-disabled={!savedName}>
                <FieldTitle id="squad-label">Squads disponíveis</FieldTitle>
                <ToggleGroup
                  aria-labelledby="squad-label"
                  className="squad-choice"
                  disabled={!savedName}
                  onValueChange={(values) => setSelectedSquad(values[0] ?? "")}
                  orientation="vertical"
                  value={[selectedSquad || currentSquad?.id || ""]}
                  variant="outline"
                >
                  {state.data?.squads.map((squad) => (
                    <ToggleGroupItem key={squad.id} value={squad.id}>
                      <span>{String(squad.ordinal).padStart(2, "0")}</span>
                      <strong>{squad.name}</strong>
                      <Badge variant="outline">{squad.members.length}</Badge>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>
                  {savedName
                    ? "Trocar de squad move seu registro, sem duplicar você."
                    : "Registre seu nome antes de escolher."}
                </FieldDescription>
              </Field>
              <Button
                disabled={pending || !savedName || !selectedSquad}
                onClick={joinSquad}
                type="button"
              >
                <MapPinIcon data-icon="inline-start" />
                Confirmar squad
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="harness-card">
          <CardHeader>
            <CardTitle>Meu harness</CardTitle>
            <CardDescription>
              Traga o seu pela rede local ou use um processo hospedado pelo
              admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-disabled={!(savedName && roomCode)}>
                <FieldTitle id="harness-label">Harness local</FieldTitle>
                <ToggleGroup
                  aria-labelledby="harness-label"
                  disabled={!(savedName && roomCode)}
                  onValueChange={(values) =>
                    setHarnessId(values[0] ?? "opencode")
                  }
                  value={[harnessId]}
                  variant="outline"
                >
                  <ToggleGroupItem value="opencode">OpenCode</ToggleGroupItem>
                  <ToggleGroupItem value="claude-code">
                    Claude Code
                  </ToggleGroupItem>
                  <ToggleGroupItem value="codex">Codex</ToggleGroupItem>
                  {fakeHarnessEnabled ? (
                    <ToggleGroupItem value="fake">
                      Fake de ensaio
                    </ToggleGroupItem>
                  ) : null}
                </ToggleGroup>
                <FieldDescription>
                  O comando roda no seu computador. Credenciais nunca passam
                  pelo board ou pelo hub.
                </FieldDescription>
              </Field>
              <div className="command-slip">
                <code>{joinCommand}</code>
                <Button
                  disabled={!(roomCode && savedName)}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(joinCommand)
                      .then(() => toast.success("Comando copiado."));
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ClipboardIcon data-icon="inline-start" />
                  Copiar
                </Button>
              </div>
              <div aria-live="polite" className="harness-status">
                {personalHarness?.connected ? (
                  <>
                    <CheckIcon aria-hidden="true" />
                    Conectado como {personalHarness.nickname}
                  </>
                ) : (
                  <>
                    <PlugZapIcon aria-hidden="true" />
                    Aguardando o túnel pessoal
                  </>
                )}
              </div>
              {ownedHarness?.hosted ? (
                <p className="field-note">
                  Hospedado reservado: {ownedHarness.nickname}
                </p>
              ) : null}
              {!ownedHarness?.hosted && availableHosted.length > 0 ? (
                <Field>
                  <FieldTitle>Hospedados livres</FieldTitle>
                  <div className="hosted-list">
                    {availableHosted.map((harness) => (
                      <Button
                        disabled={pending || !savedName}
                        key={harness.participantId}
                        onClick={() => claimHosted(harness.participantId)}
                        type="button"
                        variant="outline"
                      >
                        Reivindicar {harness.nickname}
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null}
              {!ownedHarness?.hosted && availableHosted.length === 0 ? (
                <p className="field-note">Nenhum hospedado livre agora.</p>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
