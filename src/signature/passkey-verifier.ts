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
// Проверок две, обе — методами порта: подпись оплаты (кирпич К3а) и регистрация ключа (кирпич К2, ниже).
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { PasskeyVerifier, VerifyAssertionInput, VerifyRegistrationInput } from "./webauthn.js";

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

    /**
     * Проверка ответа регистрации.
     *
     * **Что проверяется и что нет — названо, а не умолчано** (требование владельца 22.11.2026 по К2 п. 1). Библиотека
     * сверяет вызов, источник страницы, `rp_id`, тип `webauthn.create`, признак подтверждения человеком и разбирает
     * `attestationObject`, отдавая открытый ключ и начальный счётчик. **Цепочка сертификатов attestation к корню
     * доверия не ведётся:** перечень доверенных корней задаётся у этой библиотеки отдельной службой метаданных
     * (`MetadataService` с набором FIDO MDS или своим списком банка), и она **не подключена** — проверять цепочку не к
     * чему. Названо точно, потому что рычаг легко спутать: `attestationType` — параметр **выдачи** вызова
     * (`generateRegistrationOptions`), а не проверки ответа, и этот кирпич его не вызывает (находка ревью К2 № 7).
     * Для пасскея это обычное положение дел —
     * платформенный аутентификатор отдаёт `fmt: "none"`, то есть attestation как доказательства происхождения
     * устройства здесь нет вовсе.
     *
     * Поэтому **найденная в 13.2.2 дыра GHSA-6hxq-p678-4hr2 нас не касалась и не касается**: она про то, что
     * `validateCertificatePath()` не убеждался в завершении цепочки на настроенном корне, — у нас цепочки нет. Версия
     * 13.3.3 починила саму проверку, но **не включает её за нас**: остаточный риск назван строкой в `STATUS.md`
     * «Открыто» с адресом (договор с банком пилота, Р-1662).
     *
     * Что это значит по существу: приложение доверяет **ключу**, а не устройству. Для ПЭП по варианту А (Р-1716) этого
     * достаточно — подпись доказывает, что подписал тот же ключ, который человек зарегистрировал, и что он подтвердил
     * касанием. Доказательства «это подлинный аутентификатор такого-то производителя» у нас нет, и оно не обещается.
     */
    async verifyRegistration(input: VerifyRegistrationInput) {
      try {
        const out = await verifyRegistrationResponse({
          response: {
            id: input.answer.id,
            rawId: input.answer.id,
            type: "public-key",
            clientExtensionResults: {},
            response: { clientDataJSON: input.answer.client_data, attestationObject: input.answer.attestation },
          },
          expectedChallenge: input.expected_challenge,
          expectedOrigin: input.expected_origin,
          expectedRPID: input.expected_rp_id,
          requireUserVerification: true,
        });
        const info = out.registrationInfo;
        if (!out.verified || info === undefined) {
          o.onRefused(new Error("регистрация пасскея: библиотека не подтвердила ответ"));
          return { verified: false, passkey_id: "", public_key: "", counter: 0, user_verified: false };
        }
        return {
          verified: true,
          passkey_id: info.credential.id,
          public_key: Buffer.from(info.credential.publicKey).toString("base64url"),
          counter: info.credential.counter,
          user_verified: info.userVerified,
        };
      } catch (e: unknown) {
        o.onRefused(e);
        return { verified: false, passkey_id: "", public_key: "", counter: 0, user_verified: false };
      }
    },
  };
}
