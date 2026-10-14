// Бренд банка — настройкой (инвариант 7, П1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrand } from "../../src/brand.js";

const example = JSON.parse(readFileSync(join(process.cwd(), "config/brand.example.json"), "utf8")) as Record<string, unknown>;

describe("бренд банка из конфигурации", () => {
  it("пример конфигурации разбирается", () => {
    const b = parseBrand(example);
    expect(b.name).toBe(example["name"]);
    expect(b.colors.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it.each([
    ["не объект", null],
    ["пустое название", { ...example, name: " " }],
    ["нет логотипа", { ...example, logo: undefined }],
    ["цвет не #RRGGBB", { ...example, colors: { primary: "green", onPrimary: "#FFFFFF", accent: "#1F4FB8" } }],
    ["нет цветов", { ...example, colors: undefined }],
  ])("неверная конфигурация — ошибка: %s", (_name, raw) => {
    expect(() => parseBrand(raw)).toThrow(/brand/);
  });
});
