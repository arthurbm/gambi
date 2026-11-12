/**
 * Room password hashing. PBKDF2-HMAC-SHA256 over WebCrypto, which Bun, Node
 * and browsers all ship, so nothing here depends on a `Bun.*` API.
 *
 * A stored hash is `pbkdf2-sha256$<iterations>$<salt>$<key>` (base64 parts).
 * The iteration count travels in the hash, so raising the default later does
 * not invalidate the hashes already held by a running hub.
 */
import { Context, Effect, Layer, Result } from "effect";
import { Digest, Kdf, Mac, SecureRandom } from "effect/crypto";
import { Base64 } from "effect/encoding";

const SCHEME = "pbkdf2-sha256";
/** The OWASP recommendation for PBKDF2-HMAC-SHA256. */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_ITERATIONS = 10_000_000;

const encoder = new TextEncoder();

export class RoomPasswords extends Context.Service<
  RoomPasswords,
  {
    /** Hashes `password` with a fresh random salt. */
    readonly hash: (password: string) => Effect.Effect<string>;
    /** Whether `password` is the one `hash` was made from. A malformed hash matches nothing. */
    readonly verify: (password: string, hash: string) => Effect.Effect<boolean>;
  }
>()("gambi/core/RoomPasswords") {
  static readonly layer = Layer.effect(
    RoomPasswords,
    Effect.gen(function* () {
      const kdf = yield* Kdf.Kdf;
      const random = yield* SecureRandom.SecureRandom;

      const derive = (password: string, salt: Uint8Array, iterations: number) =>
        kdf
          .derive(
            Kdf.pbkdf2({ hash: Digest.sha256, iterations }),
            encoder.encode(password),
            { salt, length: KEY_BYTES }
          )
          .pipe(Effect.orDie);

      const hash = Effect.fn("RoomPasswords.hash")(function* (
        password: string
      ) {
        const salt = yield* random.randomBytes(SALT_BYTES);
        const key = yield* derive(password, salt, ITERATIONS);
        return [
          SCHEME,
          ITERATIONS,
          Base64.encode(salt),
          Base64.encode(key),
        ].join("$");
      });

      const verify = Effect.fn("RoomPasswords.verify")(function* (
        password: string,
        stored: string
      ) {
        const [scheme, iterationsText, saltText, keyText] = stored.split("$");
        const iterations = Number(iterationsText);
        const salt = Base64.decode(saltText ?? "");
        const expected = Base64.decode(keyText ?? "");
        if (
          scheme !== SCHEME ||
          !Number.isSafeInteger(iterations) ||
          iterations < 1 ||
          iterations > MAX_ITERATIONS ||
          Result.isFailure(salt) ||
          Result.isFailure(expected) ||
          expected.success.length !== KEY_BYTES
        ) {
          return false;
        }
        const actual = yield* derive(password, salt.success, iterations);
        return Mac.timingSafeEqual(actual, expected.success);
      });

      return RoomPasswords.of({ hash, verify });
    })
  );

  /** `layer` on the WebCrypto of the running platform (`globalThis.crypto`). */
  static readonly layerWebCrypto = RoomPasswords.layer.pipe(
    Layer.provide([Kdf.layerWebCrypto, SecureRandom.layerWebCrypto])
  );
}
