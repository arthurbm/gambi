import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  FastForwardIcon,
  ShieldAlertIcon,
  SkipForwardIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { ADMIN_TOKEN_KEY, client, orpc, queryClient } from "@/lib/orpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminPage });

const NEXT_PHASE: Record<string, string> = {
  lobby: "round:1",
  "round:1": "round:2",
  "round:2": "round:3",
  "round:3": "round:4",
  "round:4": "round:5",
  "round:5": "round:6",
  "round:6": "finale",
};

function initialToken() {
  const url = new URL(window.location.href);
  const token =
    url.searchParams.get("token") ??
    window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ??
    "";
  if (token) {
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }
  return token;
}

function AdminPage() {
  const [token] = useState(initialToken);
  const state = useQuery(orpc.board.state.queryOptions());
  const config = useQuery({
    ...orpc.admin.getConfig.queryOptions(),
    enabled: Boolean(token),
    retry: false,
  });
  const [theme, setTheme] = useState("");
  const [squadCount, setSquadCount] = useState(6);
  const [hostedHarnessCount, setHostedHarnessCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"advance" | "skip" | null>(
    null
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
    }
  }, []);

  useEffect(() => {
    if (!config.data) {
      return;
    }
    setTheme(config.data.theme);
    setSquadCount(config.data.squadCount);
    setHostedHarnessCount(config.data.hostedHarnessCount);
  }, [config.data]);

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await client.admin.configure({ theme, squadCount, hostedHarnessCount });
      await queryClient.invalidateQueries();
      toast.success("Configuração registrada.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a configuração."
      );
    } finally {
      setPending(false);
    }
  }

  async function changePhase(action: "advance" | "skip") {
    setPending(true);
    try {
      const result =
        action === "advance"
          ? await client.phase.advance()
          : await client.phase.skip();
      await queryClient.invalidateQueries();
      setConfirmAction(null);
      toast.success(`Fase atualizada para ${result.currentPhase}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível mudar a fase."
      );
    } finally {
      setPending(false);
    }
  }

  if (!token || config.isError) {
    return (
      <main className="interior-page narrow-page">
        <Alert variant="destructive">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle>Token de admin necessário</AlertTitle>
          <AlertDescription>
            Abra esta página com <code>/admin?token=SEU_TOKEN</code>. O token
            fica apenas nesta aba.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const lobbyLocked = state.data?.config.currentPhase !== "lobby";
  const currentRound = state.data?.rounds.find(
    (round) => `round:${round.number}` === state.data?.config.currentPhase
  );
  const currentPhase = state.data?.config.currentPhase;
  const nextPhase = currentPhase ? NEXT_PHASE[currentPhase] : undefined;
  const phaseUnavailable = state.isPending || state.isError || !currentPhase;

  return (
    <main className="interior-page">
      <header className="interior-heading admin-heading">
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
        <Badge variant="destructive">Admin</Badge>
        <h1>Controle de campo</h1>
        <p>
          Configuração de lobby e avanço das rodadas. Mudanças de fase ficam no
          histórico.
        </p>
      </header>

      <div className="form-ledger admin-ledger">
        <Card>
          <CardHeader>
            <CardTitle>Configuração do lobby</CardTitle>
            <CardDescription>
              {lobbyLocked
                ? "Bloqueada porque o evento já começou."
                : "Defina o tema e o tamanho da sala antes da primeira rodada."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveConfig}>
              <FieldGroup>
                <Field data-disabled={lobbyLocked}>
                  <FieldLabel htmlFor="theme">Tema</FieldLabel>
                  <Input
                    disabled={lobbyLocked}
                    id="theme"
                    maxLength={120}
                    onChange={(event) => setTheme(event.target.value)}
                    value={theme}
                  />
                </Field>
                <Field data-disabled={lobbyLocked}>
                  <FieldLabel htmlFor="squad-count">
                    Quantidade de squads
                  </FieldLabel>
                  <Input
                    disabled={lobbyLocked}
                    id="squad-count"
                    max={12}
                    min={1}
                    onChange={(event) =>
                      setSquadCount(event.target.valueAsNumber)
                    }
                    type="number"
                    value={squadCount}
                  />
                  <FieldDescription>Entre 1 e 12.</FieldDescription>
                </Field>
                <Field data-disabled={lobbyLocked}>
                  <FieldLabel htmlFor="harness-count">
                    Harnesses hospedados
                  </FieldLabel>
                  <Input
                    disabled={lobbyLocked}
                    id="harness-count"
                    max={12}
                    min={0}
                    onChange={(event) =>
                      setHostedHarnessCount(event.target.valueAsNumber)
                    }
                    type="number"
                    value={hostedHarnessCount}
                  />
                  <FieldDescription>
                    O número fica persistido agora. O spawn entra no ticket #74.
                  </FieldDescription>
                </Field>
                <Button
                  disabled={pending || lobbyLocked || theme.trim().length === 0}
                  type="submit"
                >
                  Salvar configuração
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fase atual</CardTitle>
            <CardDescription>
              {state.data?.config.currentPhase ?? "Carregando..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Alert>
                <ShieldAlertIcon aria-hidden="true" />
                <AlertTitle>Ação irreversível</AlertTitle>
                <AlertDescription>
                  Avançar ou pular muda toda a sala e grava a transição no
                  diário de campo.
                </AlertDescription>
              </Alert>
              {confirmAction ? (
                <div className="phase-confirmation">
                  <p>
                    Confirmar {currentPhase} → {nextPhase}? Esta transição não
                    pode ser desfeita.
                  </p>
                  <Button
                    disabled={pending || phaseUnavailable}
                    onClick={() => changePhase(confirmAction)}
                    type="button"
                    variant="destructive"
                  >
                    Confirmar transição
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => setConfirmAction(null)}
                    type="button"
                    variant="outline"
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    disabled={
                      pending || phaseUnavailable || currentPhase === "finale"
                    }
                    onClick={() => setConfirmAction("advance")}
                    type="button"
                  >
                    <FastForwardIcon data-icon="inline-start" />
                    Avançar fase
                  </Button>
                  <Button
                    disabled={
                      pending || phaseUnavailable || !currentRound?.skippable
                    }
                    onClick={() => setConfirmAction("skip")}
                    type="button"
                    variant="outline"
                  >
                    <SkipForwardIcon data-icon="inline-start" />
                    Pular rodada atual
                  </Button>
                </>
              )}
              <FieldDescription>
                Somente as rodadas 3 e 5 são puláveis.
              </FieldDescription>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
