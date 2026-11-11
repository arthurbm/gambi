/**
 * The tunnels of one hub: the bootstrap tokens that authenticate a tunnel's
 * WebSocket upgrade, and the open tunnels themselves.
 */
import type { BootstrapToken } from "@gambi/protocol";
import { Clock, Context, Duration, Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";

/** How long a bootstrap token is valid for. */
export const BOOTSTRAP_TOKEN_TTL = Duration.seconds(60);

interface IssuedToken {
  readonly expiresAt: number;
  readonly participantId: string;
  readonly roomCode: string;
}

export class Tunnels extends Context.Service<
  Tunnels,
  {
    /**
     * Issues the bootstrap token for one tunnel of one participant: single
     * use, valid for `BOOTSTRAP_TOKEN_TTL`.
     */
    readonly issueToken: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<BootstrapToken>;
  }
>()("gambi/core/Tunnels") {
  static readonly layer = Layer.effect(
    Tunnels,
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom;
      const tokens = new Map<string, IssuedToken>();

      const issueToken = Effect.fn("Tunnels.issueToken")(function* (
        roomCode: string,
        participantId: string
      ) {
        const now = yield* Clock.currentTimeMillis;
        // Tokens that were never used leave here, without a timer.
        for (const [token, issued] of tokens) {
          if (issued.expiresAt <= now) {
            tokens.delete(token);
          }
        }
        const token = yield* random.uuidV4();
        const expiresAt = now + Duration.toMillis(BOOTSTRAP_TOKEN_TTL);
        tokens.set(token, { roomCode, participantId, expiresAt });
        return { token, expiresAt };
      });

      return Tunnels.of({ issueToken });
    })
  );
}
