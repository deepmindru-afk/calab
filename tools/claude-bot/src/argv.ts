// Command lines of the claude modes. Pure functions, so tests can pin exactly what each mode may do.

/** /check: the lead on Opus with full rights in the lead checkout (the owner's own trust level). */
export function leadArgv(prompt: string): string[] {
  return ['-p', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', prompt];
}

/** Read-only paths of the assistant's checkout (relative to its cwd). */
export const ASSIST_READ_PATHS = ['./docs/**', './apps/**'] as const;

/** The handoff tool's subcommands each mode may call (`handoff` = "<node> <…/handoff.mjs>"). */
export const ASSIST_HANDOFF_VERBS = ['add', 'board'] as const;
export const WAKE_HANDOFF_VERBS = ['add', 'reply', 'chat', 'gh', 'board'] as const;

/**
 * Settings passed inline (`--settings`): the file tools and Claude Code's built-in read-only Bash commands
 * (cat, head, grep, find…) may not read outside the working directory. Without it those commands run
 * without a prompt in every mode, on any path a Read deny rule does not name.
 */
export const SANDBOX_SETTINGS = JSON.stringify({ permissions: { blockReadsOutsideWorkingDirectories: true } });

/**
 * One rule per fixed command: the handoff tool, which parses its own arguments (src/tools.ts). No `gh`,
 * `python3` or any other program directly: Bash prefix rules are not a boundary (`gh pr comment:*` also
 * admits `-R other/repo` and `--body-file ~/.ssh/…`; `python3 * status:*` matches `python3 -c …`).
 */
function handoffRules(handoff: string, verbs: readonly string[]): string[] {
  return verbs.map((v) => `Bash(${handoff} ${v}:*)`);
}

export function assistAllowedTools(handoff: string): string[] {
  return [...ASSIST_READ_PATHS.flatMap((p) => [`Read(${p})`, `Grep(${p})`, `Glob(${p})`]), ...handoffRules(handoff, ASSIST_HANDOFF_VERBS)];
}

/** Paths no sandboxed run may read: secrets, the owner's checkout and session data, the inbox. */
function secretReads(home: string, ownerRepo: string, inboxDir: string): string[] {
  const homeRel = (p: string): string => `~/${p}`;
  const abs = (p: string): string => `/${p.replace(/^\/+/, '/')}`; // permission rules: //abs/path
  // Not ~/.calab-claude-bot as a whole: the runs' checkout lives there (its env files and inbox are below).
  const homeDirs = ['.calab-tools', '.claude', '.ssh', '.aws', '.config', '.kube', '.docker', '.gnupg', '.local', 'Library', 'Documents', 'Desktop', 'Downloads'];
  const homeFiles = ['.netrc', '.npmrc', '.gitconfig', '.zsh_history', '.bash_history', '.claude.json'];
  return [
    './.env*',
    './**/.env*',
    './.git/**',
    './.claude/**',
    ...homeDirs.map((d) => homeRel(`${d}/**`)),
    ...homeFiles.map(homeRel),
    abs(`${ownerRepo}/**`),
    abs(`${home}/.calab-claude-bot/*.env`),
    abs(`${inboxDir}/**`),
  ];
}

/**
 * Bash programs no sandboxed run may call, even inside `$(…)` or a pipe (deny rules match nested
 * commands): Claude Code runs its built-in read-only set (cat, head, grep, find, ls…) without a prompt,
 * and the rest are readers, interpreters or network tools a manipulated run could exfiltrate with.
 */
export const DENIED_PROGRAMS = [
  ...['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'ls', 'stat', 'file', 'wc', 'du', 'diff', 'cmp'],
  ...['strings', 'xxd', 'od', 'hexdump', 'base64', 'sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'tee', 'nl', 'rev', 'column'],
  ...['env', 'printenv', 'set', 'export', 'declare', 'ps', 'lsof', 'security', 'defaults', 'plutil', 'sqlite3', 'mdfind', 'mdls'],
  ...['git', 'gh', 'curl', 'wget', 'nc', 'ssh', 'scp', 'rsync', 'python', 'python3', 'node', 'npx', 'pnpm', 'npm', 'bash', 'sh', 'zsh'],
  ...['osascript', 'open', 'pbcopy', 'pbpaste', 'cp', 'mv', 'ln', 'dd', 'tar', 'zip', 'unzip', 'xargs', 'eval', 'exec', 'source'],
] as const;

export function sandboxDisallowedTools(home: string, ownerRepo: string, inboxDir: string): string[] {
  return [
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'WebFetch',
    'WebSearch',
    'Agent',
    'Task',
    ...DENIED_PROGRAMS.map((p) => `Bash(${p}:*)`),
    ...secretReads(home, ownerRepo, inboxDir).flatMap((p) => [`Read(${p})`, `Grep(${p})`, `Glob(${p})`]),
  ];
}

/** Flags common to the sandboxed runs: no settings, MCP, skills or CLAUDE.md; refuse whatever is not allowed. */
function sandboxFlags(maxBudgetUsd: number): string[] {
  return [
    '--safe-mode',
    '--strict-mcp-config',
    '--setting-sources=',
    '--settings',
    SANDBOX_SETTINGS,
    '--disable-slash-commands',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--max-budget-usd',
    String(maxBudgetUsd),
  ];
}

/**
 * The Sonnet assistant: only Read/Grep/Glob/Bash exist (`--tools`), Bash only for the handoff tool (board
 * reads, comments, new tasks, labels; requests to the lead), reads only in docs/ and apps/ of its own
 * checkout. The chat goes on stdin.
 */
export function assistArgv(opts: { systemPrompt: string; handoff: string; home: string; ownerRepo: string; inboxDir: string; maxBudgetUsd?: number }): string[] {
  return [
    '-p',
    '--model',
    'sonnet',
    '--output-format',
    'json',
    ...sandboxFlags(opts.maxBudgetUsd ?? 0.5),
    '--system-prompt',
    opts.systemPrompt,
    '--tools',
    'Read,Grep,Glob,Bash',
    '--allowedTools',
    ...assistAllowedTools(opts.handoff),
    '--disallowedTools',
    ...sandboxDisallowedTools(opts.home, opts.ownerRepo, opts.inboxDir),
  ];
}

// ---- wake runs: the lead woken by the poller, on untrusted input, so never bypassPermissions ----

export function wakeAllowedTools(handoff: string): string[] {
  return ['Read(./**)', 'Grep(./**)', 'Glob(./**)', ...handoffRules(handoff, WAKE_HANDOFF_VERBS)];
}

/**
 * A wake run: the lead on `model` in a clean checkout of main (not the owner's), `dontAsk` with an explicit
 * allowlist (repo reads and the handoff tool only). The prompt goes on stdin (the tool lists are variadic).
 */
export function wakeArgv(opts: { model: string; handoff: string; home: string; ownerRepo: string; inboxDir: string; maxBudgetUsd: number }): string[] {
  return [
    '-p',
    '--model',
    opts.model,
    '--output-format',
    'stream-json',
    '--verbose',
    ...sandboxFlags(opts.maxBudgetUsd),
    '--tools',
    'Read,Grep,Glob,Bash',
    '--allowedTools',
    ...wakeAllowedTools(opts.handoff),
    '--disallowedTools',
    ...sandboxDisallowedTools(opts.home, opts.ownerRepo, opts.inboxDir),
  ];
}
