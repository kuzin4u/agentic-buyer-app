// ИН-П2, кирпич К3а — адаптер порта `PasskeyVerifier` к библиотеке **`@simplewebauthn/server`** (решение владельца
// 22.11.2026, **Р-1721**; пин точной версией, **Р-1722**: Node проекта остаётся ≥ 20.19).
//
// Зачем адаптер отдельным файлом: библиотека — внешняя сторона, и её форма входа не должна протекать в правила
// приложения. Правила живут в `webauthn.ts` и проверяются подменяемым портом; здесь только перевод формы П37 в форму
// библиотеки и обратно — ровно то, что правило планов № 1 называет «работа через порт».
//
// **Криптографию приложение не пишет само** (довод решения): разбор `authenticatorData`, проверка подписи над
// `authenticatorData ‖ sha256(clientDataJSON)`, сверка `rpIdHash`, флагов и типа `webauthn.get` — у библиотеки. Своего
// разборщика двоичного формата от недоверенной стороны у приложения нет и не появляется.
//
// Чего здесь нет: регистрации. Её проверка приходит кирпичом **К2** вместе с записью регистрации — порт расширится
// вторым методом, и адаптер получит `verifyRegistrationResponse` той же библиотеки.
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { PasskeyVerifier, VerifyAssertionInput } from "./webauthn.js";

/**
 * Проверяющий на библиотеке.
 *
 * `requireUserVerification: true` — подпись пасскея принимается **только с подтверждением человека** (биометрия или
 * код устройства): это и есть «подтверждение каждой оплаты человеком» (Р-1703) на уровне аутентификатора. Без флага
 * библиотека приняла бы подпись ключом без всякого участия человека, и инвариант 3 держался бы на словах.
 *
 * Исход `verified: false` библиотека отдаёт исключением, а не полем, поэтому исключение здесь **переводится в исход**:
 * негодная подпись — это отказ `PASSKEY_SIGNATURE_INVALID` человеку (код ставит `webauthn.ts`), а не падение
 * маршрута. Текст исключения наружу не уходит: это данные внешней стороны, им место в журнале.
 */
export function createPasskeyVerifier(o: { readonly onRefused: (e: unknown) => void }): PasskeyVerifier {
  // Приём причины — **обязательный** параметр (находка ревью К3а № 5): пока он был необязательным, при
  // `createPasskeyVerifier()` причина отказа не уходила никуда, а комментарий обещал журнал. Теперь тот, кто поднял
  // сервер, обязан сказать, куда её писать.
  if (typeof o.onRefused !== "function") throw new TypeError("проверяющий пасскея: не передан приём причины отказа (журнал обязателен)");
  return {
    async verifyAssertion(input: VerifyAssertionInput) {
      try {
        const out = await verifyAuthenticationResponse({
          response: {
            id: input.assertion.passkey_id,
            rawId: input.assertion.passkey_id,
            type: "public-key",
            clientExtensionResults: {},
            response: {
              clientDataJSON: input.assertion.client_data,
              authenticatorData: input.assertion.authenticator_data,
              signature: input.assertion.signature,
            },
          },
          expectedChallenge: input.expected_challenge,
          expectedOrigin: input.expected_origin,
          expectedRPID: input.expected_rp_id,
          requireUserVerification: true,
          credential: {
            id: input.assertion.passkey_id,
            publicKey: Buffer.from(input.public_key, "base64url"),
            // **Нуль здесь не беспечность, а одно место для правила** (находка ревью К3а № 1): при непустом значении
            // библиотека отбивает регресс счётчика **раньше** проверки подписи и своим исключением, и тогда признак
            // копии ключа приходил человеку как «подпись не сошлась», а правило приложения становилось мёртвым кодом.
            // Сравнение с прежним счётчиком делает `checkPaymentAssertion`, у него же и свой код отказа.
            counter: 0,
          },
        });
        return {
          verified: out.verified,
          counter: out.authenticationInfo.newCounter,
          user_verified: out.authenticationInfo.userVerified,
        };
      } catch (e: unknown) {
        // Причина — в журнал процесса тому, кто поднял сервер; человеку уходит код и готовый текст (правило 3 К-Б).
        o.onRefused(e);
        return { verified: false, counter: 0, user_verified: false };
      }
    },
  };
}
