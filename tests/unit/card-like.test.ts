// Х3: общий генератор строки, похожей на номер карты, для тестов фильтра (не номер карты и не секрет —
// `tests/support/card-like.ts`).
import { describe, expect, it } from "vitest";
import { cardLikeNumber, luhnOk } from "../support/card-like.js";

describe("cardLikeNumber (Х3, П-3.3 № 13)", () => {
  it("16 цифр, первая — 9 (не схема карт), контрольная — Луна; разные `fill` — разные строки; не цифра — отказ", () => {
    for (const f of ["0", "1", "2", "3", "9"]) {
      const n = cardLikeNumber(f);
      expect(n, f).toMatch(/^9\d{15}$/);
      expect(luhnOk(n), f).toBe(true);
      // испорченная контрольная цифра — уже не проходит
      const bad = n.slice(0, 15) + String((Number(n[15]) + 1) % 10);
      expect(luhnOk(bad), f).toBe(false);
    }
    expect(cardLikeNumber("1")).not.toBe(cardLikeNumber("2"));
    // независимый эталон алгоритма Луна (11 цифр — не номер карты): общая ошибка в обеих функциях не пройдёт
    expect(luhnOk("79927398713")).toBe(true);
    expect(luhnOk("79927398710")).toBe(false);
    expect(() => cardLikeNumber("12")).toThrow();
    expect(() => cardLikeNumber("x")).toThrow();
  });
});
