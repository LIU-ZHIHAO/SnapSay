# Wordbook Learning Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn record correction into a practical wordbook learning flow: users paste their final corrected text, SnapSay compares it with the text it produced, and the changed terms are accumulated into the wordbook for future recordings.

**Architecture:** Keep learning logic in the main process so renderer code only submits the final corrected text and displays results. Compare the current displayed text (`cleanedText` when present, otherwise `transcript`) against the user's corrected text, extract changed term pairs, and merge each pair into `settings.input.wordbook` by adding new variants to existing target words or creating a new target word. Keep the existing ASR hard replacement and LLM wordbook prompt path.

**Tech Stack:** Electron IPC, React renderer, TypeScript, Vitest, SQLite-backed records plus Electron Store settings.

---

### Task 1: Backend Wordbook Learning

**Files:**
- Modify: `src/main/wordbook.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Test: `tests/wordbook.test.ts`
- Test: `tests/inputController.test.ts`

- [ ] **Step 1: Add failing wordbook merge tests**

Add tests in `tests/wordbook.test.ts` proving:
- `extractWordPairCandidates('我今天用 cloud code 改代码', '我今天用 Claude Code 改代码')` returns `{ from: 'cloud code', to: 'Claude Code' }`.
- A new helper `mergeWordbookPairs` appends `cloud code` to an existing `Claude Code` entry without duplicating variants.
- `mergeWordbookPairs` creates a new entry when the correct target does not exist.

Run: `npx vitest run tests/wordbook.test.ts`
Expected: FAIL because `mergeWordbookPairs` does not exist and the current extraction is weak for this flow.

- [ ] **Step 2: Implement backend wordbook merge**

In `src/main/wordbook.ts`, add an exported `mergeWordbookPairs(entries, pairs)` helper that:
- trims empty values,
- ignores pairs where wrong and correct text are equal case-insensitively,
- finds an existing target by case-insensitive exact match,
- appends the wrong form to `variants` if missing,
- creates a new `WordbookEntry` with `generateId()` when no target exists,
- returns `{ wordbook, addedPairs }`.

Improve candidate extraction enough for short mixed Chinese/English corrections such as `cloud code -> Claude Code`, while avoiding whole-sentence learning.

Run: `npx vitest run tests/wordbook.test.ts`
Expected: PASS.

- [ ] **Step 3: Add main-process learning API**

Change `snapsay:save-correction` in `src/main/main.ts` so saving a correction:
- stores the corrected final text on the record,
- compares `record.cleanedText ?? record.transcript` with the corrected text,
- calls `extractWordPairCandidates`,
- merges pairs into `settings.input.wordbook`,
- saves the updated wordbook,
- returns `{ ok: true, pairs, wordbook }`.

Keep `snapsay:extract-word-pairs` for compatibility, but make it compare the displayed text against the saved correction rather than always using raw transcript. Also include the wordbook prompt in `rewrite-record`, so manual rewrite uses the same词库 context.

Expose the richer return type in `src/main/preload.ts`.

- [ ] **Step 4: Add pipeline-level tests**

Add or update tests proving:
- saving a correction based on a record with cleaned text learns from the cleaned text, not the raw transcript;
- existing wordbook target gets only a new wrong spelling;
- manual rewrite includes the wordbook prompt.

Run: `npx vitest run tests/inputController.test.ts tests/wordbook.test.ts`
Expected: PASS.

Commit: `git add src/main/wordbook.ts src/main/main.ts src/main/preload.ts tests/wordbook.test.ts tests/inputController.test.ts && git commit -m "feat: learn wordbook entries from corrections"`

---

### Task 2: Renderer Correction Experience

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app-render.test.tsx`

- [ ] **Step 1: Add failing renderer tests**

Add tests in `tests/app-render.test.tsx` proving:
- opening correction pre-fills the textarea with the current displayed text, not an empty field;
- after submitting corrected text, the UI displays learned pairs;
- when the backend returns an updated wordbook, the settings state is updated;
- expanding a record shows original extraction and整理后文本 separately.

Run: `npx vitest run tests/app-render.test.tsx`
Expected: FAIL because the current UI requires manual paste and does not show the learned result clearly.

- [ ] **Step 2: Improve record correction flow**

In `src/renderer/App.tsx`:
- make the correction textarea default to `record.userCorrection ?? record.refined ?? record.original`;
- call `saveCorrection` and use its returned `{ pairs, wordbook }` directly;
- update the local wordbook state when a returned wordbook exists;
- show a status such as `已学习：cloud code -> Claude Code`;
- keep manual candidate confirmation only as a fallback if the backend returns pairs but no wordbook.

- [ ] **Step 3: Add record detail view**

In `src/renderer/App.tsx` and `src/renderer/styles.css`:
- add a compact expand/collapse control on each record card;
- default card still shows the final displayed text;
- expanded view shows `原始提取`, `整理后文本`, and `我的修正文案` when present;
- long text remains clipped by default and can be inspected with hover/title or expansion, respecting the project table/long-text layout rule.

- [ ] **Step 4: Verify renderer behavior**

Run: `npx vitest run tests/app-render.test.tsx`
Expected: PASS.

Commit: `git add src/renderer/App.tsx src/renderer/styles.css tests/app-render.test.tsx && git commit -m "feat: improve wordbook correction workflow"`

---

### Task 3: Integration Verification

**Files:**
- No feature files unless a fix is required.

- [ ] **Step 1: Run targeted tests**

Run: `npx vitest run tests/wordbook.test.ts tests/inputController.test.ts tests/app-render.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS. If `better_sqlite3.node` is locked, stop the running SnapSay Electron process and retry.

- [ ] **Step 3: Final commit if integration fixes were needed**

If integration fixes were needed, commit them with:

`git commit -m "fix: stabilize wordbook learning integration"`

---

### Scope Notes

- This plan does not add a new database table. The first implementation stores learned spellings in the existing wordbook settings.
- This plan does not try to learn from every paste automatically outside SnapSay. Learning happens when the user opens a record correction and submits the final corrected text.
- This plan keeps ASR hard replacement plus LLM prompt injection; it only makes the wordbook easier to build and inspect.
