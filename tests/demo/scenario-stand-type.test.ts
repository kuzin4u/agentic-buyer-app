// П-11.4г (повторное ревью П-11.4в № 1): граница эмулятора клиента — типом. Сюжетам (`DemoScenarios`) банк стенда отдан только
// чтениями (`ScenarioStand`): подпись, подтверждение и отзыв за клиента — ошибка компиляции. Проверка — `npm run check` (tsc
// проверяет и `tests/`): если тип перестанет сужать, директивы `@ts-expect-error` ниже станут лишними — и это тоже ошибка tsc.
// Граница — компиляции: приведения и `Reflect.get` её обходят (остаток назван у типа `ScenarioStand`).
import { describe, expect, it } from "vitest";
import type { DemoScenarios, ScenarioStand } from "../../src/demo/scenarios.js";
import type { DemoStand } from "../../src/demo/stand.js";

describe("П-11.4г: стенд сюжетов — банк только для чтения (тип)", () => {
  it("sign / confirm / revoke / revokeAll / signRequest у банка сюжетов нет; upkCode и setLimits есть; полный стенд подходит", () => {
    const probe = (s: ScenarioStand) => {
      // @ts-expect-error — подпись за клиента сюжету недоступна (П5 п. 5)
      void s.stand.issuer.sign;
      // @ts-expect-error — подтверждение за клиента сюжету недоступно
      void s.stand.issuer.confirm;
      // @ts-expect-error — отзыв за клиента сюжету недоступен
      void s.stand.issuer.revoke;
      // @ts-expect-error — отзыв всех полномочий клиента
      void s.stand.issuer.revokeAll;
      // @ts-expect-error — подписанный запрос банка
      void s.stand.issuer.signRequest;
      // @ts-expect-error — действия стенда «Отозвать поручение» / «Остановить покупку» (отзыв за клиента через банк) — не сюжету
      void s.stand.demo;
      // @ts-expect-error — запрос в приложение стенда в обход сети
      void s.stand.app;
      // @ts-expect-error — страница УПК стенда
      void s.stand.upk;
      // @ts-expect-error — экран мандатов банка
      void s.stand.bankApp;
      return [s.stand.issuer.upkCode, s.stand.issuer.setLimits, s.stand.params, s.stand.calls, s.stand.now, s.stand.suspendAgent, s.stand.reinstateAgent];
    };
    // Сборка (`run.ts`) передаёт полный стенд — он подходит к суженному типу без приведения.
    const accepts = (d: DemoStand): ScenarioStand => d;
    // Конструктор сюжетов принимает именно суженный стенд: если он снова потребует полный `DemoStand`, суженный к нему не
    // подойдёт — тип ниже станет `false`, и присваивание `true` не скомпилируется.
    const ctor: [ScenarioStand] extends [ConstructorParameters<typeof DemoScenarios>[0]] ? true : false = true;
    // И не шире (повторное ревью № 4): параметр `unknown`, `any` или полный стенд с необязательными полями тоже краснеет.
    const notWider: [ConstructorParameters<typeof DemoScenarios>[0]] extends [ScenarioStand] ? true : false = true;
    expect([typeof probe, typeof accepts, ctor, notWider]).toEqual(["function", "function", true, true]);
  });
});
