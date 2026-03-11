import type { Command } from "commander";
import {
  orgCreateCommand,
  orgCurrentCommand,
  orgDeleteCommand,
  orgListCommand,
  orgSwitchCommand,
} from "../commands/org.commands.js";
import { defaultRuntime } from "../runtime.js";

export function registerOrgCli(program: Command): void {
  const org = program.command("org").description("Manage organizations (multi-tenancy)");

  org
    .command("list")
    .description("List all organizations")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await orgListCommand(opts, defaultRuntime);
    });

  org
    .command("current")
    .description("Show the currently active organization")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await orgCurrentCommand(opts, defaultRuntime);
    });

  org
    .command("create")
    .description("Create a new organization")
    .requiredOption("--name <name>", "Organization display name")
    .option("--id <id>", "Organization ID (auto-generated from name if omitted)")
    .option("--description <desc>", "Optional description")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await orgCreateCommand(opts, defaultRuntime);
    });

  org
    .command("switch")
    .description("Set the active organization")
    .argument("<id>", "Organization ID to activate")
    .option("--json", "Output JSON", false)
    .action(async (id, opts) => {
      await orgSwitchCommand(id, opts, defaultRuntime);
    });

  org
    .command("delete")
    .description("Delete an organization")
    .argument("<id>", "Organization ID to delete")
    .option("--force", "Skip confirmation prompt", false)
    .option("--json", "Output JSON", false)
    .action(async (id, opts) => {
      await orgDeleteCommand(id, opts, defaultRuntime);
    });
}
