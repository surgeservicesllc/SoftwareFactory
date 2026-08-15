/**
 * Argument parsing for the `agentos` CLI.
 *
 * Separate from the script because one rule here is safety-critical and
 * deserves a test that does not need a database: `--prune` deletes records,
 * and it is only honoured alongside `--yes`. Everything else is shape.
 */

export type AgentosCommand = "push" | "pull" | "help";

export type AgentosOptions = {
  command: AgentosCommand;
  project: string | null;
  file: string;
  prune: boolean;
  confirmed: boolean;
};

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

const COMMANDS: readonly string[] = ["push", "pull", "help"];
const VALUE_FLAGS: readonly string[] = ["--project", "--file"];

export function parseAgentosArguments(argv: readonly string[]): AgentosOptions {
  const [rawCommand, ...rest] = argv;
  const command = rawCommand ?? "help";
  if (!COMMANDS.includes(command)) {
    throw new CliError(`Unknown command "${command}". Try: agentos help`);
  }

  const options: AgentosOptions = {
    command: command as AgentosCommand,
    project: null,
    file: "agentos.yml",
    prune: false,
    confirmed: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--prune") { options.prune = true; continue; }
    if (flag === "--yes") { options.confirmed = true; continue; }

    if (VALUE_FLAGS.includes(flag)) {
      const value = rest[index + 1];
      // A value starting with `--` is almost always a forgotten argument
      // rather than a filename, and consuming it would silently write to the
      // wrong place.
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(`${flag} needs a value.`);
      }
      if (flag === "--project") options.project = value; else options.file = value;
      index += 1;
      continue;
    }

    throw new CliError(`Unknown option "${flag}". Try: agentos help`);
  }

  if (options.command !== "help" && !options.project) {
    throw new CliError(`${options.command} needs --project.`);
  }

  return options;
}

/** True only when the caller both asked to delete and confirmed it. */
export function mayPrune(options: AgentosOptions): boolean {
  return options.prune && options.confirmed;
}

/** The drift report, as lines a person reads before deciding to delete. */
export function describeDrift(extra: Record<string, string[]>): string[] {
  return Object.entries(extra)
    .filter(([, names]) => Array.isArray(names) && names.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collection, names]) => `  ${collection}: ${[...names].sort().join(", ")}`);
}
