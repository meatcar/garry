#!/usr/bin/env bun
import { gstack, run, status, teardown } from "./commands.ts";

const args = process.argv.slice(2);

const USAGE = `garry — run claude with gstack in an isolated sandbox

Garry is claude. Anything you pass is forwarded straight to claude, sandboxed:

  garry                         launch claude (first run installs gstack)
  garry --resume                → claude --resume
  garry -p "..."                → claude -p "..."
  garry mcp list                → claude mcp list

Everything garry-specific lives under "garry gstack":

  garry gstack [setup args...]  install / refresh gstack (forwards args, e.g. --team, --no-prefix)
  garry gstack status           show sandbox state
  garry gstack teardown         remove the sandbox entirely
  garry gstack --help           show this help

To update gstack, run /gstack-upgrade inside a session, or re-run "garry gstack".

Environment:
  GARRY_SANDBOX_DIR   override the sandbox root directory
`;

if (args[0] === "gstack") {
  const [sub, ...rest] = args.slice(1);
  switch (sub) {
    case "status":
      await status();
      break;
    case "teardown":
      await teardown();
      break;
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      break;
    // No subcommand, or anything else (--team, --host, ...) → gstack setup.
    default:
      await gstack(sub === undefined ? [] : [sub, ...rest]);
  }
} else {
  await run(args);
}
