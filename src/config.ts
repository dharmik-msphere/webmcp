import { join, dirname } from "path";
import { homedir } from "os";
import { mkdir, readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set CONFIG_DIR to the project root (one level up from src/ or dist/)
export const CONFIG_DIR = join(__dirname, "..");
export const PID_FILE = join(CONFIG_DIR, ".webmcp-server.pid");
export const TOKENS_FILE = join(CONFIG_DIR, ".webmcp-tokens.json");
export const ENV_FILE = join(CONFIG_DIR, ".env");
export const DEFAULT_PORT = 9000;

export interface AppConfig {
  port: number;
  quit: boolean;
  newToken: boolean;
  startMCP: boolean;
  cleanTokens: boolean;
  daemon: boolean;
}

export let CONFIG: AppConfig = {
  port: DEFAULT_PORT,
  quit: false,
  newToken: false,
  startMCP: false,
  cleanTokens: false,
  daemon: true,
};

export function setConfig(newConfig: Partial<AppConfig>) {
  CONFIG = { ...CONFIG, ...newConfig };
}

export async function ensureConfigDir() {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
  } catch (error: any) {
    if (error.code !== "EEXIST") {
      console.error("Error creating config directory:", error);
    }
  }
}

export function formatChannel(host: string): string {
  let formatted = host.replace(/:/g, "_");
  formatted = formatted.replace(/\./g, "_");
  if (!formatted.startsWith("/")) {
    formatted = "/" + formatted;
  }
  return formatted;
}

export async function configureMcpClient(
  client:
    | "claude"
    | "cursor"
    | "cline"
    | "windsurf"
    | "antigravity"
    | "gemini"
    | "copilot"
    | string,
) {
  // Determine the configuration path based on the client type
  let configPath = "";
  const platform = process.platform;
  const homeDir = homedir();

  switch (client) {
    case "claude":
      if (platform === "darwin") {
        configPath = join(
          homeDir,
          "Library/Application Support/Claude/claude_desktop_config.json",
        );
      } else if (platform === "win32") {
        configPath = join(
          process.env.APPDATA || "",
          "Claude/claude_desktop_config.json",
        );
      } else {
        configPath = join(homeDir, ".config/Claude/claude_desktop_config.json");
      }
      break;
    case "cursor":
      // Cursor usually configures this via the UI, but we can try to find its state file or prompt the user
      console.log(
        "Cursor requires manual configuration. Please add the following to your Cursor MCP settings:",
      );
      console.log(`Command: node`);
      console.log(`Args: ${process.argv[1]} --mcp`);
      return;
    case "cline":
      if (platform === "darwin") {
        configPath = join(
          homeDir,
          "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } else if (platform === "win32") {
        configPath = join(
          process.env.APPDATA || "",
          "Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } else {
        configPath = join(
          homeDir,
          ".config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      }
      break;
    case "windsurf":
      configPath = join(homeDir, ".codeium/windsurf/mcp_config.json");
      break;
    case "antigravity":
      configPath = join(homeDir, ".gemini/antigravity/mcp_config.json");
      break;
    case "copilot":
      configPath = join(homeDir, ".copilot/mcp-config.json");
      break;
    case "gemini":
    default:
      configPath = client;
  }

  try {
    let configContent = "{}";
    try {
      configContent = await readFile(configPath, "utf8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }

    const config = JSON.parse(configContent);
    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers.webmcp = {
      command: "node",
      args: [process.argv[1], "--mcp"],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`Successfully configured ${client} MCP client.`);
  } catch (error) {
    console.error(`Failed to configure ${client}:`, error);
  }
}
