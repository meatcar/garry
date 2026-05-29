#!/usr/bin/env bun
import { run, setup, status, teardown, update } from "./commands.ts";

const [cmd, ...rest] = process.argv.slice(2);

const USAGE = `garry — run gstack in an isolated sandbox

Usage:
  garry setup   [-- <gstack-setup-args>]   install gstack into the sandbox
  garry run     [-- <claude-args>]          launch claude with gstack (sandboxed)
  garry update  [-- <gstack-setup-args>]   pull latest gstack and re-run setup
  garry teardown                            remove the sandbox entirely
  garry status                             show sandbox state

Environment:
  GARRY_SANDBOX_DIR   override the sandbox root directory
`;

switch (cmd) {
  case "setup":
    await setup(rest);
    break;
  case "run":
    await run(rest);
    break;
  case "update":
    await update(rest);
    break;
  case "teardown":
    await teardown();
    break;
  case "status":
    await status();
    break;
  default:
    process.stderr.write(USAGE);
    process.exit(cmd ? 1 : 0);
}
