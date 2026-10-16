/**
 * Parse `launchctl print` for one fleet agent. Shared by status, shepherd, and launchd.
 *
 *   launchdInfo('Jackpoo1') → { loaded, pid, runs, lastExit, state, programArgs }
 */
export interface LaunchdInfo {
    loaded: boolean;
    pid?: number | null;
    runs?: number | null;
    lastExit?: string | null;
    state?: string | null;
    programArgs?: string[];
}

const LABEL_PREFIX = 'com.rs-sdk.bot';

export function agentLabel(name: string): string {
    return `${LABEL_PREFIX}.${name.toLowerCase()}`;
}

/** ProgramArguments with the bun executable stripped, rejoined as a `bun …` command. */
export function commandFromProgramArgs(args: string[]): string {
    if (args.length === 0) return '';
    const bunIndex = args.findIndex((arg) => /(^|\/)bun$/.test(arg));
    const rest = bunIndex >= 0 ? args.slice(bunIndex + 1) : args;
    return ['bun', ...rest].join(' ');
}

export function parseLaunchctlPrint(output: string, ok: boolean): LaunchdInfo {
    if (!ok) return { loaded: false };
    const pidRaw = output.match(/\bpid = (\d+)/)?.[1];
    const runsRaw = output.match(/\bruns = (\d+)/)?.[1];
    const lastExit = output.match(/\blast exit code = ([^\n]+)/)?.[1]?.trim() ?? null;
    const state = output.match(/\bstate = ([^\n]+)/)?.[1]?.trim() ?? null;
    const argsBlock = output.match(/arguments = \{([^}]*)\}/);
    const programArgs = argsBlock
        ? argsBlock[1]!.split('\n').map((line) => line.trim()).filter(Boolean)
        : [];
    return {
        loaded: true,
        pid: pidRaw ? Number(pidRaw) : null,
        runs: runsRaw ? Number(runsRaw) : null,
        lastExit,
        state,
        programArgs,
    };
}

/** `{ loaded: false }` when the agent is not bootstrapped. */
export function launchdInfo(name: string): LaunchdInfo {
    const uid = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
    const proc = Bun.spawnSync(['launchctl', 'print', `gui/${uid}/${agentLabel(name)}`], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
    return parseLaunchctlPrint(output, proc.exitCode === 0);
}
