#!/usr/bin/env node
// owlit-agent: the Owlit engine (Beta) as an ACP agent over stdio. owlit starts it like any installed
// agent. OWLIT_ENGINE_HOME is its own folder (sign-ins); OWLIT_ENGINE_FAUX=1 swaps the models for a
// scripted one, for tests.

import * as acp from "@agentclientprotocol/sdk"
import { homedir } from "node:os"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { Engine } from "./engine.ts"
import { fauxModels } from "./faux.ts"
import { createEngineModels, FileCredentials } from "./models.ts"

// stdout carries ACP, so anything said goes to stderr (owlit shows it with OWLIT_LOG_AGENTS)
const log = (line: string) => process.stderr.write(`${line}\n`)

const home = process.env.OWLIT_ENGINE_HOME ?? path.join(homedir(), ".owlit-engine")
const credentials = new FileCredentials(path.join(home, "auth.json"))
const models = process.env.OWLIT_ENGINE_FAUX ? fauxModels(credentials) : createEngineModels(credentials)

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>)
new acp.AgentSideConnection((conn) => new Engine(conn, models, credentials, home, log), stream)
