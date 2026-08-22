import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, MapPinIcon, UserRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
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

function MePage() {
  const state = useQuery(orpc.board.state.queryOptions());
  const personId = useMemo(() => getPersonId(), []);
  const [name, setName] = useState(getStoredName);
  const [savedName, setSavedName] = useState(getStoredName);
  const currentSquad = state.data?.squads.find((squad) =>
    squad.members.some((member) => member.id === personId)
  );
  const [selectedSquad, setSelectedSquad] = useState("");
  const [pending, setPending] = useState(false);

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
      </div>
    </main>
  );
}
