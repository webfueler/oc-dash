/**
 * The service registry file.
 *
 *   $XDG_STATE_HOME/oc-dash/service.json
 *   ~/.local/state/oc-dash/service.json   when XDG_STATE_HOME is unset
 *
 * That is the same discovery rule `@opencode/client` uses for
 * `$XDG_STATE_HOME/opencode/service.json`
 * (`node_modules/@opencode/client/dist/promise/service.js` reads it that way),
 * and it is the contract the oc-dashbar menu bar twin reads. The `??`
 * semantics are copied rather than improved on: if the two implementations
 * ever disagree about an unset-versus-empty `XDG_STATE_HOME`, the twin reads
 * a different file than we wrote, which is exactly the failure this file
 * exists to prevent.
 *
 * `port` and `pid` are the source of truth. `url` is composed from the port
 * on the way out and is recomposed on the way back in, so the two can never
 * disagree no matter what is sitting in the file.
 *
 * The file is the only handle `server stop` has on the process, which makes
 * it also the only thing that can point at somebody else's process; see
 * procinfo.ts for what happens before anything is signalled.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface ServiceRecord {
  port: number
  pid: number
  url: string
  version: string
}

/**
 * True when the CLI started this process as the background service, via
 * `oc-dash server start`. It is the single switch for the two behaviours a
 * direct `node dist-server/index.js` must never grow: falling back to a free
 * port when the requested one is busy, and owning this registry file. A
 * bare `npx oc-dash` no longer starts a server at all, so no CLI path
 * reaches the server without this switch.
 */
export function serviceMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OC_DASH_SERVICE === "1"
}

/** Where the registry lives, following the @opencode/client rule. */
export function registryPath(env: NodeJS.ProcessEnv = process.env): string {
  const state = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(state, "oc-dash", "service.json")
}

/** The only place a service URL is spelled out; port is the source of truth. */
export function serviceUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/**
 * oc-dash's own version, read from the manifest one level up. Same trick and
 * same URL as server/index.ts, for the same reason (tsconfig.server.json's
 * rootDir forbids a bare JSON import); the two answers are kept independent
 * because one feeds the update banner and the other feeds this file.
 */
export function appVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown }
    if (typeof pkg.version === "string") return pkg.version
  } catch {
    // Best effort: an unreadable manifest only costs the version label.
  }
  return "unknown"
}

/**
 * Publish this process as the running service. Written to a sibling temp
 * file and renamed, so a reader (the twin, `server status`) never observes a
 * half-written file and mistakes it for a dead service.
 */
export function writeRegistry(
  record: { port: number; pid: number },
  path: string = registryPath(),
): ServiceRecord {
  const full: ServiceRecord = {
    port: record.port,
    pid: record.pid,
    url: serviceUrl(record.port),
    version: appVersion(),
  }
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(full, null, 2)}\n`, "utf8")
  renameSync(temp, path)
  return full
}

export type RegistryRead =
  | { kind: "missing" }
  | { kind: "unreadable"; reason: string }
  | { kind: "malformed"; reason: string }
  | { kind: "ok"; record: ServiceRecord }

/**
 * Read and validate. `missing`, `unreadable` and `malformed` are separate
 * answers because the caller has to treat them differently: a malformed file
 * is something to refuse to touch, not something to overwrite.
 */
export function readRegistry(path: string = registryPath()): RegistryRead {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { kind: "missing" }
    return { kind: "unreadable", reason: (err as Error).message }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { kind: "malformed", reason: `not valid JSON (${(err as Error).message})` }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "malformed", reason: "top level is not an object" }
  }
  const { port, pid } = parsed as { port?: unknown; pid?: unknown }
  if (!Number.isInteger(port) || (port as number) < 1) {
    return { kind: "malformed", reason: `"port" is not a positive integer (${JSON.stringify(port)})` }
  }
  if (!Number.isInteger(pid) || (pid as number) < 1) {
    return { kind: "malformed", reason: `"pid" is not a positive integer (${JSON.stringify(pid)})` }
  }
  // version is informational; a missing one must not make the record unusable.
  const version = typeof (parsed as { version?: unknown }).version === "string"
    ? ((parsed as { version: string }).version)
    : "unknown"
  return {
    kind: "ok",
    record: {
      port: port as number,
      pid: pid as number,
      url: serviceUrl(port as number),
      version,
    },
  }
}

/** Remove the registry. True when it is gone afterwards, absent or deleted. */
export function removeRegistry(path: string = registryPath()): boolean {
  try {
    rmSync(path, { force: true })
    return true
  } catch {
    return false
  }
}
