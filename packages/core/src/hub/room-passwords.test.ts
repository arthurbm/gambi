import { expect } from "bun:test";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { RoomPasswords } from "./room-passwords.ts";

layer(RoomPasswords.layerWebCrypto)("room passwords", (it) => {
  it.effect("accepts the password a hash was made from", () =>
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;
      const hash = yield* passwords.hash("segredo-da-sala");

      expect(yield* passwords.verify("segredo-da-sala", hash)).toBe(true);
    })
  );

  it.effect("refuses any other password", () =>
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;
      const hash = yield* passwords.hash("segredo-da-sala");

      expect(yield* passwords.verify("segredo-da-sal", hash)).toBe(false);
      expect(yield* passwords.verify("", hash)).toBe(false);
    })
  );

  it.effect("salts each hash and keeps the password out of it", () =>
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;

      const first = yield* passwords.hash("segredo-da-sala");
      const second = yield* passwords.hash("segredo-da-sala");

      expect(first).not.toBe(second);
      expect(first).not.toContain("segredo-da-sala");
    })
  );

  it.effect("matches nothing against a hash it did not make", () =>
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;

      // The format of the hub this one replaces, and plain garbage.
      expect(
        yield* passwords.verify(
          "x",
          "$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$aGFzaA"
        )
      ).toBe(false);
      expect(yield* passwords.verify("x", "")).toBe(false);
      expect(yield* passwords.verify("x", "pbkdf2-sha256$0$AAAA$AAAA")).toBe(
        false
      );
    })
  );

  it.effect("verifies a hash made by another WebCrypto runtime", () =>
    Effect.gen(function* () {
      const passwords = yield* RoomPasswords;
      // PBKDF2-HMAC-SHA256, 1000 iterations, salt "0123456789abcdef", made with Node's `crypto.pbkdf2Sync`.
      const fromNode =
        "pbkdf2-sha256$1000$MDEyMzQ1Njc4OWFiY2RlZg==$w6PW9NVT72ltB6TYDmjK7UxHQmO1THU6d0Pdu/Sz+FQ=";

      expect(yield* passwords.verify("segredo-da-sala", fromNode)).toBe(true);
    })
  );
});
