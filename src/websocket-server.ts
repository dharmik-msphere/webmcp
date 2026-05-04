import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'path';
import {
    CONFIG,
    DEFAULT_PORT,
    setConfig,
    ensureConfigDir,
    configureMcpClient
} from './config.js';
import {
    generateNewRegistrationToken,
    loadAuthorizedTokens,
    saveAuthorizedTokens,
    clearTokens,
    setToken,
    isValidToken,
    serverToken,
    saveServerTokenToEnv,
    generateToken,
    loadServerTokenFromEnv
} from './tokens.js';
import { runMcpServer } from './server.js';

const MCP_PATH = '/mcp';
const REGISTER_PATH = '/register';

// Registries
const channels: Record<string, Set<WebSocket>> = {};
const toolsRegistry: Record<string, any> = {};
const promptsRegistry: Record<string, any> = {};
const resourcesRegistry: Record<string, any> = {};

let requestIdCounter = 1;
const pendingRequests: Record<string, { originalId: string, requesterWs: WebSocket, timestamp: number }> = {};

function getPathFromUrl(urlStr: string): string {
    try {
        const url = new URL(urlStr, 'http://localhost');
        return url.pathname;
    } catch {
        return '/';
    }
}

function getQueryParam(urlStr: string, param: string): string | null {
    try {
        const url = new URL(urlStr, 'http://localhost');
        return url.searchParams.get(param);
    } catch {
        return null;
    }
}

export async function main() {
    await ensureConfigDir();
    await loadAuthorizedTokens();
    loadServerTokenFromEnv();

    const args = process.argv.slice(2);
    let port = DEFAULT_PORT;
    
    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mcp') setConfig({ startMCP: true });
        if (args[i] === '--foreground') setConfig({ daemon: false });
        if (args[i] === '--new') setConfig({ newToken: true });
        if (args[i] === '--config' && args[i+1]) {
            await configureMcpClient(args[i+1]);
            process.exit(0);
        }
    }

    if (CONFIG.newToken) {
        const token = await generateNewRegistrationToken();
        console.log(`\nCONNECTION TOKEN:\n${token}\n`);
        process.exit(0);
    }

    if (!serverToken) {
        const t = generateToken();
        await saveServerTokenToEnv(t);
    }

    if (CONFIG.startMCP) {
        // Start MCP client mode
        await runMcpServer(serverToken);
        return;
    }

    // Start WebSocket Server Hub
    const httpServer = createServer((req, res) => {
        res.writeHead(200);
        res.end('WebMCP Relay Server is running.');
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws, req) => {
        const url = req.url || '/';
        const path = getPathFromUrl(url);

        if (path === REGISTER_PATH) {
            handleRegistration(ws);
            return;
        }

        const token = getQueryParam(url, 'token');
        
        if (path === MCP_PATH) {
            if (token !== serverToken) {
                ws.close(4001, 'Unauthorized MCP');
                return;
            }
            setupMcpConnection(ws);
            return;
        }

        // Channel connection
        if (!token || !isValidToken(path, token)) {
            ws.close(4001, 'Unauthorized Channel');
            return;
        }

        setupChannelConnection(ws, path);
    });

    httpServer.listen(port, () => {
        console.error(`WebSocket server running at ws://localhost:${port}`);
    });
}

function handleRegistration(ws: WebSocket) {
    ws.once('message', async (data) => {
        try {
            const decoded = Buffer.from(data.toString(), 'base64').toString('utf8');
            const payload = JSON.parse(decoded);
            
            // In a real app we'd validate payload.token matches what we generated.
            // For now, accept and generate a session token.
            const sessionToken = generateToken();
            const channel = '/' + payload.host.replace(/[:.]/g, '_');
            
            setToken(channel, sessionToken);
            await saveAuthorizedTokens();

            ws.send(JSON.stringify({
                type: 'registerSuccess',
                token: sessionToken,
                message: 'Registration successful'
            }));
            
        } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid registration' }));
            ws.close();
        }
    });
}

function setupMcpConnection(ws: WebSocket) {
    if (!channels[MCP_PATH]) channels[MCP_PATH] = new Set();
    channels[MCP_PATH].add(ws);

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'listTools') {
                const tools = Object.values(toolsRegistry).map(t => ({
                    name: t.originalName,
                    description: t.description,
                    inputSchema: t.inputSchema
                }));
                ws.send(JSON.stringify({ type: 'listToolsResponse', id: msg.id, tools }));
                return;
            }

            if (msg.type === 'callTool') {
                const toolInfo = Object.values(toolsRegistry).find(t => t.originalName === msg.tool);
                if (!toolInfo) {
                    ws.send(JSON.stringify({ id: msg.id, type: 'toolResponse', error: `Tool not found` }));
                    return;
                }

                const targetChannel = toolInfo.channel;
                const clients = channels[targetChannel];
                if (!clients || clients.size === 0) {
                    ws.send(JSON.stringify({ id: msg.id, type: 'toolResponse', error: `Browser disconnected` }));
                    return;
                }

                const targetClient = clients.values().next().value;
                const reqId = (++requestIdCounter).toString();
                pendingRequests[reqId] = { originalId: msg.id, requesterWs: ws, timestamp: Date.now() };

                targetClient.send(JSON.stringify({
                    id: reqId,
                    type: 'callTool',
                    tool: toolInfo.originalName,
                    arguments: msg.arguments
                }));
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        channels[MCP_PATH].delete(ws);
    });
}

function setupChannelConnection(ws: WebSocket, channel: string) {
    if (!channels[channel]) channels[channel] = new Set();
    channels[channel].add(ws);

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'registerTool') {
                const uniqueId = `${channel}:${msg.name}`;
                toolsRegistry[uniqueId] = {
                    channel,
                    originalName: msg.name,
                    description: msg.description,
                    inputSchema: msg.inputSchema
                };
            }

            if (msg.type === 'toolResponse') {
                const req = pendingRequests[msg.id];
                if (req) {
                    req.requesterWs.send(JSON.stringify({
                        id: req.originalId,
                        type: 'toolResponse',
                        result: msg.result,
                        error: msg.error
                    }));
                    delete pendingRequests[msg.id];
                }
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        channels[channel].delete(ws);
        
        // Remove tools associated with this channel if it's empty
        if (channels[channel].size === 0) {
            for (const key of Object.keys(toolsRegistry)) {
                if (toolsRegistry[key].channel === channel) {
                    delete toolsRegistry[key];
                }
            }
        }
    });
}

// Ensure execution starts
if (import.meta.url.startsWith('file:') && process.argv[1] && import.meta.url.includes(process.argv[1].split('/').pop()!)) {
    main().catch(console.error);
}
