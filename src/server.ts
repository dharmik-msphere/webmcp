import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    CreateMessageRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from 'ws';
import { generateNewRegistrationToken } from './tokens.js';

export async function runMcpServer(token: string) {
    if (!token) {
        console.error("No token provided to runMcpServer");
        process.exit(1);
    }

    // Connect to the local WebSocket relay
    const wsUrl = `ws://localhost:9000/mcp?token=${token}`;
    const ws = new WebSocket(wsUrl);

    let wsReady = false;
    let requestCounter = 0;
    const pendingRequests = new Map<string, { resolve: Function, reject: Function, timeout: any }>();

    const mcpServer = new Server({
        name: "WebMCP",
        version: "1.0.0",
    }, {
        capabilities: {
            tools: {},
            prompts: {},
            resources: {},
            sampling: {}
        }
    });

    ws.on('open', () => {
        wsReady = true;
    });

    ws.on('close', () => {
        wsReady = false;
        console.error("Connection to WebMCP relay closed");
        process.exit(1);
    });

    ws.on('error', (err) => {
        console.error("WebSocket error in MCP server:", err);
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', id: msg.id }));
                return;
            }

            if (msg.id && pendingRequests.has(msg.id.toString())) {
                const req = pendingRequests.get(msg.id.toString())!;
                clearTimeout(req.timeout);
                pendingRequests.delete(msg.id.toString());

                if (msg.error) {
                    req.reject(new Error(msg.error));
                } else {
                    req.resolve(msg);
                }
            }
        } catch (e) {
            console.error("Error parsing WS message in MCP server:", e);
        }
    });

    async function sendRequestToWs(requestPayload: any, timeoutMs = 30000): Promise<any> {
        if (!wsReady) {
            throw new Error("Not connected to WebMCP relay");
        }

        const id = (++requestCounter).toString();
        const payload = { ...requestPayload, id };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(id);
                reject(new Error(`Request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            pendingRequests.set(id, { resolve, reject, timeout });
            ws.send(JSON.stringify(payload));
        });
    }

    // Handlers
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        try {
            const response = await sendRequestToWs({ type: 'listTools' });
            const tools = response.tools || [];
            
            // Add internal tools
            tools.push({
                name: "_webmcp_get-token",
                description: "Retrieve a token to connect a website for WebMCP.",
                inputSchema: { type: "object", properties: {} }
            });

            tools.push({
                name: "_webmcp_define-mcp-tool",
                description: "Define a new tool manually via MCP. Advanced use.",
                inputSchema: { 
                    type: "object", 
                    properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        inputSchema: { type: "object" }
                    },
                    required: ["name", "description", "inputSchema"]
                }
            });

            return { tools };
        } catch (e: any) {
            console.error("Error listing tools:", e);
            return { tools: [] };
        }
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        
        if (toolName === "_webmcp_get-token") {
            const token = await generateNewRegistrationToken();
            return {
                content: [{
                    type: "text",
                    text: `CONNECTION TOKEN (paste this in your web client):\n\n${token}`
                }]
            };
        }

        if (toolName === "_webmcp_define-mcp-tool") {
            return {
                content: [{
                    type: "text",
                    text: "Tool definition acknowledged. Please ensure you also implement this in your frontend codebase."
                }]
            };
        }

        try {
            const response = await sendRequestToWs({
                type: 'callTool',
                tool: toolName,
                arguments: request.params.arguments || {}
            });
            
            if (response.result && response.result.content) {
                return response.result;
            }
            
            return {
                content: [{
                    type: "text",
                    text: typeof response.result === 'string' ? response.result : JSON.stringify(response.result)
                }]
            };
        } catch (e: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error calling tool ${toolName}: ${e.message}`
                }],
                isError: true
            };
        }
    });

    // We can implement prompt, resource, sampling similarly...

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
}
