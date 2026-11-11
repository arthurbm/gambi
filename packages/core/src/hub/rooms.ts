/**
 * The rooms of one hub. The state lives in the service instance, so two hubs
 * in one process never see each other's rooms.
 */
import {
  type CreateRoom,
  type RoomCreated,
  RoomNotFound,
  type RoomSummary,
  type RuntimeConfig,
  type RuntimeConfigPublic,
} from "@gambi/protocol";
import { Clock, Context, Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";
import { RoomPasswords } from "./room-passwords.ts";

// Uppercase letters and digits only: a code must never start with "-" (a CLI
// would read `--room -ABC12` as another option) and is easy to dictate.
const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 6;

interface RoomState {
  readonly code: string;
  readonly createdAt: number;
  readonly defaults: RuntimeConfig | undefined;
  readonly hostId: string;
  readonly id: string;
  readonly name: string;
  readonly passwordHash: string | undefined;
}

const toPublicConfig = (config: RuntimeConfig): RuntimeConfigPublic => {
  const { instructions, ...generation } = config;
  return { ...generation, hasInstructions: instructions !== undefined };
};

// The password hash and the instructions text never leave the hub.
const toSummary = (room: RoomState): RoomSummary => ({
  id: room.id,
  code: room.code,
  name: room.name,
  hostId: room.hostId,
  createdAt: room.createdAt,
  ...(room.defaults === undefined
    ? {}
    : { defaults: toPublicConfig(room.defaults) }),
  passwordProtected: room.passwordHash !== undefined,
  participantCount: 0,
});

export class Rooms extends Context.Service<
  Rooms,
  {
    /**
     * Whether `password` opens the room. A room without a password accepts
     * anything; a room with one refuses a missing password.
     */
    readonly checkPassword: (
      code: string,
      password: string | undefined
    ) => Effect.Effect<boolean, RoomNotFound>;
    readonly create: (input: CreateRoom) => Effect.Effect<RoomCreated>;
    /** Looks a room up by code, in any letter case. */
    readonly get: (code: string) => Effect.Effect<RoomSummary, RoomNotFound>;
    readonly list: Effect.Effect<readonly RoomSummary[]>;
  }
>()("gambi/core/Rooms") {
  static readonly layer = Layer.effect(
    Rooms,
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;
      const random = yield* SecureRandom.SecureRandom;
      const byCode = new Map<string, RoomState>();

      const randomCode = Effect.gen(function* () {
        let code = "";
        for (let index = 0; index < CODE_LENGTH; index++) {
          const at = yield* random.intBetween(0, CODE_ALPHABET.length - 1);
          code += CODE_ALPHABET[at];
        }
        return code;
      });

      const find = (code: string) => {
        const room = byCode.get(code.toUpperCase());
        return room === undefined
          ? Effect.fail(new RoomNotFound({ roomCode: code }))
          : Effect.succeed(room);
      };

      const create = Effect.fn("Rooms.create")(function* (input: CreateRoom) {
        const passwordHash =
          input.password === undefined
            ? undefined
            : yield* passwords.hash(input.password);
        const id = yield* random.uuidV4();
        const hostId = yield* random.uuidV4();
        const createdAt = yield* Clock.currentTimeMillis;
        let code = yield* randomCode;
        while (byCode.has(code)) {
          code = yield* randomCode;
        }
        const room: RoomState = {
          id,
          code,
          name: input.name,
          hostId,
          createdAt,
          defaults: input.defaults,
          passwordHash,
        };
        byCode.set(code, room);
        yield* Effect.logInfo("room created").pipe(
          Effect.annotateLogs({
            roomCode: code,
            passwordProtected: passwordHash !== undefined,
          })
        );
        return { room: toSummary(room), hostId };
      });

      const get = Effect.fn("Rooms.get")(function* (code: string) {
        return toSummary(yield* find(code));
      });

      const checkPassword = Effect.fn("Rooms.checkPassword")(function* (
        code: string,
        password: string | undefined
      ) {
        const room = yield* find(code);
        if (room.passwordHash === undefined) {
          return true;
        }
        if (password === undefined) {
          return false;
        }
        return yield* passwords.verify(password, room.passwordHash);
      });

      return Rooms.of({
        checkPassword,
        create,
        get,
        list: Effect.sync(() => [...byCode.values()].map(toSummary)),
      });
    })
  );
}
