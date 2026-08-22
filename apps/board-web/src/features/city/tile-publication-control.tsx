import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BoardState, client, queryClient } from "@/lib/orpc";

type Squad = BoardState["squads"][number];
type TileVersion = Awaited<ReturnType<typeof client.tiles.versions>>[number];

export function TilePublicationControl({
  squads,
  versions,
}: {
  squads: Squad[];
  versions: TileVersion[];
}) {
  const [actorName, setActorName] = useState("Facilitador");
  const [pendingSquad, setPendingSquad] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});

  async function publish(squadId: string, boardVersion: number) {
    setPendingSquad(squadId);
    try {
      await client.tiles.publish({ squadId, boardVersion, actorName });
      await queryClient.invalidateQueries();
      toast.success(`Versão ${boardVersion} publicada.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível publicar esta versão."
      );
    } finally {
      setPendingSquad(null);
    }
  }

  return (
    <section aria-labelledby="tile-publication-title" className="tile-register">
      <header>
        <div>
          <h2 id="tile-publication-title">Versões no ar</h2>
          <p>
            O aceite publica a versão válida mais recente. Use a substituição
            abaixo apenas para recuperar uma versão anterior.
          </p>
        </div>
        <Badge variant="outline">Override de admin</Badge>
      </header>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="tile-publisher">Nome no registro</FieldLabel>
          <Input
            id="tile-publisher"
            maxLength={80}
            onChange={(event) => setActorName(event.target.value)}
            value={actorName}
          />
          <FieldDescription>
            Este nome fica no diário de publicação.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <ol className="tile-version-list">
        {squads.map((squad) => {
          const squadVersions = versions.filter(
            (version) => version.squadId === squad.id
          );
          const selected =
            selection[squad.id] ??
            String(
              squadVersions.find((version) => version.isLive)?.boardVersion ??
                squadVersions.find((version) => version.valid)?.boardVersion ??
                ""
            );
          return (
            <li key={squad.id}>
              <div>
                <strong>{squad.name}</strong>
                <span>
                  {squadVersions.length
                    ? `${squadVersions.length} ${squadVersions.length === 1 ? "versão" : "versões"}`
                    : "Nenhum artifact recebido"}
                </span>
              </div>
              <Select
                disabled={squadVersions.length === 0}
                onValueChange={(value) =>
                  setSelection((current) => ({
                    ...current,
                    [squad.id]: String(value),
                  }))
                }
                value={selected}
              >
                <SelectTrigger aria-label={`Versão de ${squad.name}`}>
                  <SelectValue placeholder="Sem versão" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {squadVersions.map((version) => (
                      <SelectItem
                        disabled={!version.valid}
                        key={version.id}
                        value={String(version.boardVersion)}
                      >
                        v{version.boardVersion}
                        {version.isLive ? " · no ar" : ""}
                        {version.valid ? "" : " · inválida"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                disabled={
                  pendingSquad === squad.id ||
                  actorName.trim().length === 0 ||
                  selected.length === 0
                }
                onClick={() => publish(squad.id, Number(selected))}
                size="sm"
                type="button"
                variant="outline"
              >
                Publicar versão
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
