// Тестовый аутентификатор для кирпича К3а: **настоящая** пара ключей P-256 и настоящая подпись (`node:crypto`), а не
// заглушка. Нужен затем, что проверку подписи делает библиотека, и доказать «проверка ловит подмену» можно только
// материалом, который библиотека принимает: с заглушкой красной была бы заглушка, а не проверка (Р-1698).
//
// Своего разборщика CBOR в приложении нет и не будет (решение Р-1721) — но **кодировщик** на три формы здесь нужен,
// чтобы собрать COSE-ключ так, как его отдаёт аутентификатор. Это тестовый файл: в `src/` ничего подобного не
// появляется, и инвариант «чужой двоичный формат разбирает проверенный код» не нарушен.
//
// Реквизитов здесь нет (инвариант 1): ключ пасскея — не платёжный реквизит, номеров карт и токенов в файле нет вовсе.
import { createHash, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

const b64u = (b: Buffer): string => b.toString("base64url");

/** CBOR: беззнаковое целое (major 0) и отрицательное (major 1) — только малые значения, больше тут не нужно. */
const cborInt = (n: number): Buffer => {
  const major = n < 0 ? 0x20 : 0x00;
  const v = n < 0 ? -n - 1 : n;
  if (v < 24) return Buffer.from([major | v]);
  if (v < 0x100) return Buffer.from([major | 24, v]);
  throw new Error(`тестовый CBOR: значение ${n} вне нужного диапазона`);
};

/** CBOR: строка байтов (major 2). Кодировщика текста здесь нет намеренно: он нужен `attestationObject` регистрации, а
 *  регистрация — кирпич К2, и заводить его заранее значило бы держать в тестах мёртвый код. */
const cborBytes = (b: Buffer): Buffer => {
  if (b.length < 24) return Buffer.concat([Buffer.from([0x40 | b.length]), b]);
  if (b.length < 0x100) return Buffer.concat([Buffer.from([0x40 | 24, b.length]), b]);
  return Buffer.concat([Buffer.from([0x40 | 25, b.length >> 8, b.length & 0xff]), b]);
};

/** CBOR: map (major 5) из готовых пар. */
const cborMap = (pairs: readonly (readonly [Buffer, Buffer])[]): Buffer => {
  if (pairs.length >= 24) throw new Error("тестовый CBOR: слишком большая карта");
  return Buffer.concat([Buffer.from([0xa0 | pairs.length]), ...pairs.flatMap(([k, v]) => [k, v])]);
};

/** Открытый ключ P-256 в форме COSE_Key: `{1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}`. */
const coseKey = (pub: KeyObject): Buffer => {
  // Несжатая точка SEC1: 0x04 ‖ x(32) ‖ y(32) — её отдаёт экспорт `jwk`, разложенный на координаты.
  const jwk = pub.export({ format: "jwk" }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return cborMap([
    [cborInt(1), cborInt(2)],
    [cborInt(3), cborInt(-7)],
    [cborInt(-1), cborInt(1)],
    [cborInt(-2), cborBytes(x)],
    [cborInt(-3), cborBytes(y)],
  ]);
};

/** Флаги `authenticatorData`: UP (нажатие) и UV (подтверждение человеком). */
export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;

/** `authenticatorData`: `rpIdHash(32) ‖ flags(1) ‖ signCount(4)`. */
const authData = (rpId: string, flags: number, counter: number): Buffer => {
  const head = createHash("sha256").update(rpId).digest();
  const tail = Buffer.alloc(5);
  tail.writeUInt8(flags, 0);
  tail.writeUInt32BE(counter, 1);
  return Buffer.concat([head, tail]);
};

export interface TestAuthenticator {
  readonly passkey_id: string;
  /** COSE-ключ в base64url — в этой форме его хранит реестр (`RegisteredPasskey.public_key`) */
  readonly public_key: string;
  /** Собрать ответ на вызов. Подпись настоящая; `flags` и `counter` можно испортить нарочно. */
  assertion(o: {
    readonly challenge: string;
    readonly origin: string;
    readonly rp_id?: string;
    readonly counter?: number;
    readonly flags?: number;
    readonly type?: string;
    /** подписать не тем, что отдаём: так собирается негодная подпись при годном остальном */
    readonly tamper?: boolean;
  }): { readonly passkey_id: string; readonly client_data: string; readonly authenticator_data: string; readonly signature: string };
}

/** Аутентификатор с настоящей парой ключей. `rp_id` — тот, под который он зарегистрирован. */
export function createTestAuthenticator(rpId: string, passkeyId = "pk_test_1"): TestAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    passkey_id: passkeyId,
    public_key: b64u(coseKey(publicKey)),
    assertion(o) {
      const clientData = Buffer.from(
        JSON.stringify({ type: o.type ?? "webauthn.get", challenge: o.challenge, origin: o.origin, crossOrigin: false }),
        "utf8",
      );
      const data = authData(o.rp_id ?? rpId, o.flags ?? (FLAG_UP | FLAG_UV), o.counter ?? 1);
      const signed = Buffer.concat([data, createHash("sha256").update(clientData).digest()]);
      const signature = createSign("sha256").update(signed).sign(privateKey);
      return {
        passkey_id: passkeyId,
        client_data: b64u(clientData),
        authenticator_data: b64u(o.tamper ? authData(o.rp_id ?? rpId, o.flags ?? (FLAG_UP | FLAG_UV), (o.counter ?? 1) + 1) : data),
        signature: b64u(signature),
      };
    },
  };
}
