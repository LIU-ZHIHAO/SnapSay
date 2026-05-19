# Provider Cards And ASR Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable provider cards for LLM cleanup and ASR profiles for local, cloud upload, and cloud streaming transcription.

**Architecture:** Store provider presets and user configs in the existing Electron settings store. Renderer model settings page will select one active ASR profile at the top and render separate ASR/LLM provider card sections. Runtime code will resolve the active LLM config and active ASR config through centralized helpers before calling existing adapters.

**Tech Stack:** Electron, React, TypeScript, Vitest, existing `electron-store` based settings store.

---

### Task 1: Settings Model And Presets

**Files:**
- Modify: `src/main/settingsStore.ts`
- Test: `tests/settingsStore.test.ts`

- [ ] **Step 1: Write failing tests**
  Add tests that default settings include LLM provider configs, active cleanup provider key, ASR profiles, and active ASR profile id.

- [ ] **Step 2: Run test to verify failure**
  Run: `npm test -- tests/settingsStore.test.ts`
  Expected: FAIL because fields do not exist yet.

- [ ] **Step 3: Implement settings shape**
  Add `LlmProviderConfig`, `AsrProfileConfig`, defaults, merge logic, and compatibility with the current single-provider fields.

- [ ] **Step 4: Run test to verify pass**
  Run: `npm test -- tests/settingsStore.test.ts`
  Expected: PASS.

### Task 2: Provider Runtime

**Files:**
- Modify: `src/main/providers.ts`
- Modify: `src/main/main.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write failing tests**
  Add tests for OpenAI-compatible LLM resolution and cloud upload ASR URL construction.

- [ ] **Step 2: Run test to verify failure**
  Run: `npm test -- tests/providers.test.ts`
  Expected: FAIL because helpers/configs are missing.

- [ ] **Step 3: Implement runtime support**
  Resolve active LLM card into cleanup provider config. Resolve active ASR profile into local adapter, upload ASR adapter, or streaming placeholder adapter with a clear not-implemented message for live streaming capture.

- [ ] **Step 4: Run test to verify pass**
  Run: `npm test -- tests/providers.test.ts`
  Expected: PASS.

### Task 3: Model Page UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/ModelsView.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/app-render.test.tsx`

- [ ] **Step 1: Write failing tests**
  Assert the models page shows an ASR profile selector, ASR provider cards including cloud streaming, LLM provider cards, and per-card test buttons.

- [ ] **Step 2: Run test to verify failure**
  Run: `npm test -- tests/app-render.test.tsx`
  Expected: FAIL because card UI does not exist yet.

- [ ] **Step 3: Implement UI**
  Replace the single LLM form with card sections. Keep top ASR selector and avoid number inputs or spinner controls.

- [ ] **Step 4: Run test to verify pass**
  Run: `npm test -- tests/app-render.test.tsx`
  Expected: PASS.

### Task 4: Full Verification And Commit

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full tests**
  Run: `npm test`
  Expected: all tests pass.

- [ ] **Step 2: Run build**
  Run: `npm run build`
  Expected: typecheck, Vite build, and Electron TypeScript build pass.

- [ ] **Step 3: Commit**
  Run: `git add ... && git commit -m "Add provider cards and ASR profiles"`
  Expected: clean working tree.
