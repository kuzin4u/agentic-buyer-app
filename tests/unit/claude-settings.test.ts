// .claude/settings.json (передача kuzin4u/agentic-buyer-app#6, п. 2 и 2а; Р-1249, Р-1321, Р-1322 — РП68 дополнения 2 и 3
// Платформы): заранее разрешено только чтение, запись — с вопросом, слияние PR — запрет. Порядок Claude Code: deny → ask →
// allow. Страж guard.py подключён к PreToolUse. SETTINGS_PATH — путь к проверяемой копии (поломки).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Hook = { matcher?: string; hooks: { type: string; command: string }[] };
type Settings = { permissions: { allow: string[]; ask: string[]; deny: string[] }; hooks: Record<string, Hook[]> };

const PATH = process.env.SETTINGS_PATH ?? join(process.cwd(), ".claude/settings.json");
const settings = JSON.parse(readFileSync(PATH, "utf8")) as Settings;
const { allow, ask, deny } = settings.permissions;

const READ_ONLY = [
  "Bash(gh pr view:*)",
  "Bash(gh pr checks:*)",
  // Передача #6, п. 2 (Р-1317 (б)): безопасное чтение по Р-1249 — команды не пишут файлы и не меняют состояние.
  "Bash(git describe:*)",
  "Bash(git rev-parse:*)",
  "Bash(gh issue view:*)",
  "Bash(gh issue list:*)",
  "Bash(gh label list:*)",
  "Bash(gh pr diff:*)",
  "Bash(gh run view:*)",
  "Bash(gh run list:*)",
  "Bash(uptime)",
  // Дополнение к передаче #6, п. 1 (Р-1322): инструмента Grep в сессии может не быть — поиск grep и cut в Bash
  // (сами файлы не пишут; запись через > — нюанс (е) передачи).
  "Bash(grep:*)",
  "Bash(cut:*)",
];

// Не разрешать заранее (передача #6, п. 2; Р-1322): gh api — префикс не ограничивает метод (-X DELETE); sed — команда w
// пишет файл; awk — print > файл и system(); find — -delete и -exec; base64 — -o; python3 и node — интерпретаторы;
// echo и printf — запись через >; git -C — открыло бы запись (нюанс (д)).
const NOT_ALLOWED = /^Bash\((gh api|sed|awk|find|base64|python3?|node|echo|printf|git -C)\b/;

// Запись — с вопросом (передача #6, п. 2а; Р-1321): git — тот же набор, что GIT_ASK_SUBCOMMANDS стража (К4.1).
const ASK_GIT = ["commit", "push", "revert", "checkout", "restore", "reset", "pull"];
const ASK = [...ASK_GIT.map((s) => `Bash(git ${s}:*)`), "Bash(gh pr create:*)", "Bash(npm install:*)", "Bash(npm i:*)", "Bash(curl:*)", "Bash(wget:*)"];

describe(".claude/settings.json: чтение — без вопроса, запись — с вопросом (Р-1249)", () => {
  it("allow — ровно список только для чтения (13 правил)", () => {
    expect([...allow].sort()).toEqual([...READ_ONLY].sort());
  });

  it.each(ASK)("ask: %s", (rule) => {
    expect(ask).toContain(rule);
  });

  it("слияние PR и reset --hard — запрет; docs/reference — только чтение", () => {
    expect(deny).toEqual(expect.arrayContaining(["Bash(gh pr merge:*)", "Bash(git reset --hard:*)", "Edit(./docs/reference/**)"]));
  });

  it("изменяющие команды не разрешены заранее", () => {
    const changing = /^Bash\((git (commit|push|revert|checkout|restore|reset|pull|add|merge|rebase|tag)|gh pr (create|merge|ready|edit|comment)|gh issue (create|comment|edit|close)|npm (install|i|ci))\b/;
    expect(allow.filter((r) => changing.test(r))).toEqual([]);
    expect(allow.filter((r) => !r.startsWith("Bash("))).toEqual([]);
  });

  it("пишущие или неограниченные по методу команды не разрешены заранее (Р-1322)", () => {
    expect(allow.filter((r) => NOT_ALLOWED.test(r))).toEqual([]);
  });

  it("страж guard.py подключён к PreToolUse для Bash, Write, Edit, MultiEdit, Read", () => {
    const guard = (settings.hooks.PreToolUse ?? []).find((h) => h.hooks.some((x) => x.command.includes(".claude/hooks/guard.py")));
    expect(guard).toBeDefined();
    expect((guard?.matcher ?? "").split("|").sort()).toEqual(["Bash", "Edit", "MultiEdit", "Read", "Write"]);
  });
});
