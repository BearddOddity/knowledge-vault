import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const vault = "D:/My apps/Reverse Engineer Brain/knowledge-vault";
const entry = path.join(vault, "mcp-server", "dist", "index.js");

const client = new Client({ name: "verify", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, KNOWLEDGE_VAULT_PATH: vault },
  })
);

const details = [
  "Win32 API that reads the BeingDebugged byte at PEB+0x02 and returns it.",
  "",
  "**Spotting it:** a call to `kernel32!IsDebuggerPresent` whose result feeds a conditional jump. If the import was avoided, look for a direct read of `gs:[0x60]+0x02` (x64) or `fs:[0x30]+0x02` (x86) instead.",
  "",
  "**Defeating it:** in x64dbg, break on the call and zero EAX before the test, or patch the BeingDebugged byte to 0 once at attach so every later check passes. ScyllaHide handles both automatically.",
].join("\n");

const r = await client.callTool({
  name: "save_pattern",
  arguments: { category: "re", topic: "anti-debug", technique: "IsDebuggerPresent", details },
});
console.log(r.content.map((c) => c.text).join("\n"));
await client.close();
