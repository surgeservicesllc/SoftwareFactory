/**
 * `agentos` — configuration as code from the terminal.
 *
 * `docs/AGENTOS_SPEC.md` §17 and §22. Two verbs carry the whole contract:
 *
 *   pull   writes the workspace to `agentos.yml`
 *   push   applies `agentos.yml` to the workspace
 *
 * and the acceptance is that `pull` immediately after `push` changes nothing.
 *
 * Everything this does goes through `agentos_apply_project_config` and
 * `agentos_export_project_config`, as the signed-in user. There is no
 * service-role path: a CLI that could bypass row-level security would be a
 * credential worth stealing, and the RPCs already refuse a caller who is not
 * an owner or admin of the organization.
 *
 * Deleting is opt-in twice. `--prune` asks for it, and `--yes` confirms it
 * after the removals have been printed. A push without those flags can add and
 * update but can never remove, so an editing mistake on a laptop cannot delete
 * an agent.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  CliError,
  describeDrift,
  mayPrune,
  parseAgentosArguments,
  type AgentosOptions,
} from "@/lib/agentos/cli-options";
import {
  parseProjectConfig,
  ProjectConfigError,
  serializeProjectConfig,
} from "@/lib/agentos/project-config";

const USAGE = `agentos — configuration as code

  npm run agentos -- pull --project <name|uuid> [--file agentos.yml]
  npm run agentos -- push --project <name|uuid> [--file agentos.yml] [--prune --yes]

Options
  --project   Project name or id. Required for push and pull.
  --file      Path to the configuration file. Defaults to ./agentos.yml
  --prune     Also remove records the file does not mention. Requires --yes.
  --yes       Confirm a prune after reviewing what it would remove.

Environment
  NEXT_PUBLIC_SUPABASE_URL              the workspace URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  the publishable (anon) key
  AGENTOS_CLI_EMAIL                     the signing-in account
  AGENTOS_CLI_PASSWORD                  its password, read from the environment
                                        and never written to a file or a log
`;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CliError(`${name} is not set. Try: agentos help`);
  return value;
}

async function signIn(): Promise<SupabaseClient> {
  const url = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!key) {
    throw new CliError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Try: agentos help");
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: requiredEnvironment("AGENTOS_CLI_EMAIL"),
    password: requiredEnvironment("AGENTOS_CLI_PASSWORD"),
  });

  // The message is deliberately generic. Supabase distinguishes "no such user"
  // from "wrong password", and repeating that distinction here would make the
  // CLI a way to enumerate accounts.
  if (error) throw new CliError("Sign-in failed. Check AGENTOS_CLI_EMAIL and AGENTOS_CLI_PASSWORD.");

  return client;
}

/** Resolves a project by id or name, and returns its organization too. */
async function resolveProject(client: SupabaseClient, reference: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
  const query = client.from("projects").select("id, name, organization_id");
  const { data, error } = isUuid
    ? await query.eq("id", reference)
    : await query.eq("name", reference);

  if (error) throw new CliError(`Could not read projects: ${error.message}`);
  if (!data || data.length === 0) {
    throw new CliError(`No project matched "${reference}" in any workspace you belong to.`);
  }
  if (data.length > 1) {
    // Names are not unique across organizations, and guessing which one the
    // author meant is the kind of guess that writes to the wrong workspace.
    throw new CliError(
      `"${reference}" matches ${data.length} projects. Pass the project id instead.`,
    );
  }

  return data[0] as { id: string; name: string; organization_id: string };
}

async function pull(client: SupabaseClient, options: AgentosOptions) {
  const project = await resolveProject(client, options.project!);

  const { data, error } = await client.rpc("agentos_export_project_config", {
    p_organization_id: project.organization_id,
    p_project_id: project.id,
  });
  if (error) throw new CliError(`Export failed: ${error.message}`);

  // Round-tripped through the parser rather than written straight out, so a
  // document the database could produce but the file format could not accept
  // fails here instead of at the next push.
  const yaml = serializeProjectConfig(parseProjectConfig(JSON.stringify(data)));
  const target = resolve(process.cwd(), options.file);
  await writeFile(target, yaml, "utf8");

  process.stdout.write(`Wrote ${options.file} from ${project.name}.\n`);
}

async function push(client: SupabaseClient, options: AgentosOptions) {
  if (options.prune && !options.confirmed) {
    // Not an error yet: show what would go, then stop. Refusing without
    // saying what it would have removed would just invite a blind retry.
    process.stdout.write("--prune needs --yes. Showing what it would remove first.\n");
  }

  const project = await resolveProject(client, options.project!);
  const source = resolve(process.cwd(), options.file);
  const config = parseProjectConfig(await readFile(source, "utf8"));

  // Always applied without prune first. The result names the drift, which is
  // what a person needs in order to decide whether removing it is correct.
  const { data, error } = await client.rpc("agentos_apply_project_config", {
    p_organization_id: project.organization_id,
    p_project_id: project.id,
    p_config: config,
    p_prune: false,
  });
  if (error) throw new CliError(`Push failed: ${error.message}`);

  const result = data as { applied: Record<string, number>; extra: Record<string, string[]> };
  const counts = Object.entries(result.applied).map(([k, v]) => `${v} ${k}`).join(", ");
  process.stdout.write(`Applied to ${project.name}: ${counts}.\n`);

  const drift = describeDrift(result.extra);
  if (drift.length === 0) {
    process.stdout.write("Nothing else exists here that the file does not describe.\n");
    return;
  }

  process.stdout.write(
    `\nThese exist in ${project.name} but not in ${options.file}:\n${drift.join("\n")}\n`,
  );

  if (!options.prune) {
    process.stdout.write("\nThey were left alone. Re-run with --prune --yes to remove them.\n");
    return;
  }
  if (!mayPrune(options)) {
    process.stdout.write("\nNothing was removed. Re-run with --prune --yes to remove them.\n");
    process.exitCode = 1;
    return;
  }

  const pruned = await client.rpc("agentos_apply_project_config", {
    p_organization_id: project.organization_id,
    p_project_id: project.id,
    p_config: config,
    p_prune: true,
  });
  if (pruned.error) throw new CliError(`Prune failed: ${pruned.error.message}`);

  process.stdout.write(`\nRemoved ${(pruned.data as { pruned: number }).pruned} record(s).\n`);
}

async function main() {
  const options = parseAgentosArguments(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  const client = await signIn();
  try {
    if (options.command === "pull") await pull(client, options);
    else await push(client, options);
  } finally {
    await client.auth.signOut();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ProjectConfigError) {
    process.stderr.write(`${error.message}\n`);
    for (const issue of error.issues) process.stderr.write(`  ${issue}\n`);
    process.exitCode = 1;
  } else if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    // Never print the raw error: it can carry the connection string.
    process.stderr.write("agentos failed unexpectedly.\n");
    process.exitCode = 1;
  }
}
