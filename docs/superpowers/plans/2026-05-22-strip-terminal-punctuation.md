# Strip Terminal Punctuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove sentence-ending punctuation from ASR transcripts before cleanup, paste, and record storage.

**Architecture:** Add a small regex helper in `src/main/recorderCoordinator.ts` and apply it immediately after optional wordbook replacement. Keep ASR providers unchanged so the behavior applies to local, cloud, and future streaming paths.

**Tech Stack:** TypeScript, Electron main process, Vitest.

---

## File Structure

- Modify `src/main/recorderCoordinator.ts`: define `stripTerminalPunctuation(text: string): string` and apply it inside `runRecordingPipeline`.
- Modify `tests/inputController.test.ts`: add focused recorder coordinator tests for short text paste and interior punctuation preservation.

### Task 1: Terminal punctuation helper

**Files:**
- Modify: `tests/inputController.test.ts`
- Modify: `src/main/recorderCoordinator.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('recorderCoordinator', () => { ... })` block:

```ts
  it('strips trailing punctuation before pasting short transcripts that skip cleanup', async () => {
    const store = createSettingsStore({ store: createMemoryStore() });
    const cleanup = vi.fn().mockResolvedValue('clean text');
    const paste = vi.fn().mockResolvedValue({ status: 'pasted' });

    const record = await runRecordingPipeline({
      audio: new ArrayBuffer(0),
      durationMs: 600,
      asrProvider: createMockAsrProvider('打开设置页。'),
      cleanupText: cleanup,
      pasteText: paste,
      settingsStore: store,
      shouldCleanupText: shouldCleanupTranscript
    });

    expect(record.status).toBe('completed');
    expect(record.transcript).toBe('打开设置页');
    expect(record.cleanedText).toBeUndefined();
    expect(cleanup).not.toHaveBeenCalled();
    expect(paste).toHaveBeenCalledWith('打开设置页');
  });

  it('keeps interior punctuation and removes only continuous trailing punctuation', async () => {
    const store = createSettingsStore({ store: createMemoryStore() });
    const cleanup = vi.fn().mockResolvedValue('clean text');
    const paste = vi.fn().mockResolvedValue({ status: 'pasted' });

    const record = await runRecordingPipeline({
      audio: new ArrayBuffer(0),
      durationMs: 600,
      asrProvider: createMockAsrProvider('打开设置页，然后点击保存？！'),
      cleanupText: cleanup,
      pasteText: paste,
      settingsStore: store,
      shouldCleanupText: shouldCleanupTranscript
    });

    expect(record.transcript).toBe('打开设置页，然后点击保存');
    expect(cleanup).not.toHaveBeenCalled();
    expect(paste).toHaveBeenCalledWith('打开设置页，然后点击保存');
  });
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm test -- tests/inputController.test.ts
```

Expected: the new tests fail because the transcript and pasted text still include trailing punctuation.

- [ ] **Step 3: Implement the minimal helper**

In `src/main/recorderCoordinator.ts`, add:

```ts
const TERMINAL_PUNCTUATION_RE = /[。．，、！？!?.,，：:；;]+$/u;

export function stripTerminalPunctuation(text: string): string {
  return text.replace(TERMINAL_PUNCTUATION_RE, '');
}
```

Then replace:

```ts
    transcript = options.applyWordbook ? options.applyWordbook(asr.text) : asr.text;
```

with:

```ts
    const rawTranscript = options.applyWordbook ? options.applyWordbook(asr.text) : asr.text;
    transcript = stripTerminalPunctuation(rawTranscript);
```

- [ ] **Step 4: Verify the focused tests pass**

Run:

```bash
npm test -- tests/inputController.test.ts
```

Expected: all tests in `tests/inputController.test.ts` pass.

- [ ] **Step 5: Run broader verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit only this task's files**

Run:

```bash
git add docs/superpowers/specs/2026-05-22-strip-terminal-punctuation-design.md docs/superpowers/plans/2026-05-22-strip-terminal-punctuation.md tests/inputController.test.ts src/main/recorderCoordinator.ts
git commit -m "feat: strip trailing transcript punctuation"
```

## Self-Review

- Spec coverage: The plan applies punctuation stripping after ASR and wordbook, before cleanup and paste, and stores sanitized records.
- Placeholder scan: No placeholder steps or vague implementation instructions remain.
- Type consistency: `stripTerminalPunctuation(text: string): string` is defined in the same module where it is used.

