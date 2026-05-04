export interface ToolSchema {
    type: string;
    properties: Record<string, any>;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: ToolSchema;
    execute: (args: any) => any | Promise<any>;
}

export interface PromptDefinition {
    name: string;
    description: string;
    arguments: any[];
    execute: (args: any) => any | Promise<any>;
}

export interface ResourceDefinition {
    name: string;
    description: string;
    uri?: string;
    uriTemplate?: string;
    isTemplate?: boolean;
    mimeType?: string;
    provide: (uri: string) => any | Promise<any>;
}

export interface WebMCPOptions {
    color?: string;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    inactivityTimeout?: number;
}

export class WebMCP {
    private elementId = 'webmcp-widget';
    private SESSION_STORAGE_KEY = 'webmcp_connection';
    private REGISTER_PATH = '/register';
    
    private options: Required<WebMCPOptions>;
    private isConnected = false;
    private currentToken = '';
    private currentServer = '';
    private currentChannel = '';
    private socket: WebSocket | null = null;
    private inactivityTimer: any = null;

    private availableTools = new Map<string, ToolDefinition>();
    private availablePrompts = new Map<string, PromptDefinition>();
    private availableResources = new Map<string, ResourceDefinition>();

    private registeredTools = new Set<string>();
    private registeredPrompts = new Set<string>();
    private registeredResources = new Set<string>();

    constructor(options: WebMCPOptions = {}) {
        this.options = {
            color: options.color || '#3b82f6',
            position: options.position || 'bottom-right',
            inactivityTimeout: options.inactivityTimeout || 5 * 60 * 1000 // 5 minutes default
        };

        this._initUI();
        this._loadStoredItems();
        this._checkStoredConnection();

        // Bind events for UI
        window.addEventListener('beforeunload', () => {
            this._saveItemsToStorage();
        });
    }

    private _format(host: string): string {
        let formatted = host.replace(/:/g, '_');
        formatted = formatted.replace(/\./g, '_');
        return formatted;
    }

    private _initUI() {
        if (document.getElementById(this.elementId)) return;

        const container = document.createElement('div');
        container.id = this.elementId;
        
        let positionStyles = '';
        switch (this.options.position) {
            case 'bottom-left': positionStyles = 'bottom: 20px; left: 20px;'; break;
            case 'top-right': positionStyles = 'top: 20px; right: 20px;'; break;
            case 'top-left': positionStyles = 'top: 20px; left: 20px;'; break;
            case 'bottom-right':
            default: positionStyles = 'bottom: 20px; right: 20px;'; break;
        }

        container.setAttribute('style', `
            position: fixed;
            ${positionStyles}
            z-index: 9999;
            font-family: system-ui, -apple-system, sans-serif;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            border: 1px solid #e5e7eb;
            overflow: hidden;
            width: 300px;
            transition: all 0.3s ease;
            transform-origin: ${this.options.position.includes('bottom') ? 'bottom' : 'top'} ${this.options.position.includes('right') ? 'right' : 'left'};
        `);

        container.innerHTML = `
            <div class="webmcp-header" style="background: ${this.options.color}; color: white; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                <div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                    <div class="webmcp-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
                    WebMCP Relay
                </div>
                <button class="webmcp-toggle-btn" style="background: none; border: none; color: white; cursor: pointer; padding: 0;">▼</button>
            </div>
            <div class="webmcp-body" style="padding: 15px; font-size: 13px;">
                <div class="webmcp-status" style="margin-bottom: 12px; font-weight: 500; color: #6b7280;">Status: Disconnected</div>
                
                <div class="webmcp-connect-form">
                    <input type="password" class="webmcp-token-input" placeholder="Paste registration token..." style="width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box;" />
                    <button class="webmcp-connect-btn" style="width: 100%; padding: 8px; background: ${this.options.color}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Connect</button>
                </div>

                <div class="webmcp-disconnect-form" style="display: none;">
                    <button class="webmcp-disconnect-btn" style="width: 100%; padding: 8px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Disconnect</button>
                </div>

                <div class="webmcp-stats" style="margin-top: 15px; border-top: 1px solid #f3f4f6; padding-top: 15px; display: none;">
                    <div style="font-weight: 600; margin-bottom: 8px;">Registered</div>
                    <ul style="list-style: none; padding: 0; margin: 0; color: #4b5563;">
                        <li><span class="webmcp-tools-count">0</span> Tools</li>
                        <li><span class="webmcp-prompts-count">0</span> Prompts</li>
                    </ul>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        // Events
        const header = container.querySelector('.webmcp-header') as HTMLElement;
        const body = container.querySelector('.webmcp-body') as HTMLElement;
        const toggleBtn = container.querySelector('.webmcp-toggle-btn') as HTMLElement;
        const connectBtn = container.querySelector('.webmcp-connect-btn') as HTMLButtonElement;
        const disconnectBtn = container.querySelector('.webmcp-disconnect-btn') as HTMLButtonElement;
        const tokenInput = container.querySelector('.webmcp-token-input') as HTMLInputElement;

        let expanded = true;
        header.addEventListener('click', () => {
            expanded = !expanded;
            body.style.display = expanded ? 'block' : 'none';
            toggleBtn.textContent = expanded ? '▼' : '▲';
        });

        connectBtn.addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (token) this.connect(token);
        });

        disconnectBtn.addEventListener('click', () => {
            this.disconnect();
        });
    }

    private _updateStatus(state: 'connected' | 'disconnected' | 'connecting', message: string) {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const dot = container.querySelector('.webmcp-status-dot') as HTMLElement;
        const statusText = container.querySelector('.webmcp-status') as HTMLElement;

        if (state === 'connected') {
            dot.style.background = '#10b981'; // green
        } else if (state === 'connecting') {
            dot.style.background = '#f59e0b'; // yellow
        } else {
            dot.style.background = '#ef4444'; // red
        }

        statusText.textContent = `Status: ${message}`;
        this._updateStatsUI();
    }

    private _updateStatsUI() {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const toolsCount = container.querySelector('.webmcp-tools-count') as HTMLElement;
        const promptsCount = container.querySelector('.webmcp-prompts-count') as HTMLElement;
        
        toolsCount.textContent = this.availableTools.size.toString();
        promptsCount.textContent = this.availablePrompts.size.toString();
    }

    private _toggleConnectUI(isConnected: boolean) {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const connectForm = container.querySelector('.webmcp-connect-form') as HTMLElement;
        const disconnectForm = container.querySelector('.webmcp-disconnect-form') as HTMLElement;
        const stats = container.querySelector('.webmcp-stats') as HTMLElement;

        connectForm.style.display = isConnected ? 'none' : 'block';
        disconnectForm.style.display = isConnected ? 'block' : 'none';
        stats.style.display = isConnected ? 'block' : 'none';
    }

    private _saveItemsToStorage() {
        const toolsData: Record<string, Omit<ToolDefinition, 'execute'>> = {};
        this.availableTools.forEach((tool, name) => {
            toolsData[name] = { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
        });
        sessionStorage.setItem('webmcp_tools', JSON.stringify(toolsData));

        // Could do the same for prompts and resources, but tools are the primary focus here.
    }

    private _loadStoredItems() {
        try {
            const toolsData = JSON.parse(sessionStorage.getItem('webmcp_tools') || '{}');
            for (const [name, tool] of Object.entries(toolsData) as [string, any][]) {
                // Restore with dummy execute function until the page re-registers it
                this.availableTools.set(name, {
                    ...tool,
                    execute: async () => {
                        throw new Error(`Tool ${name} execute function was not re-registered after page load.`);
                    }
                });
            }
        } catch (e) {
            console.error('Error loading stored tools:', e);
        }
        this._updateStatsUI();
    }

    private _checkStoredConnection() {
        const stored = sessionStorage.getItem(this.SESSION_STORAGE_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                if (data.token && data.server) {
                    this.currentServer = data.server;
                    this.currentToken = data.token;
                    this.currentChannel = `/${this._format(window.location.host)}`;
                    this._connectWebSocket();
                }
            } catch (e) {
                sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
            }
        }
    }

    public async connect(base64Token: string) {
        try {
            this._updateStatus('connecting', 'Decoding token...');
            const jsonStr = atob(base64Token);
            const connectionData = JSON.parse(jsonStr);

            if (!connectionData.server || !connectionData.token) {
                throw new Error("Invalid token format");
            }

            this.currentServer = connectionData.server;
            const regToken = connectionData.token;

            this._updateStatus('connecting', 'Registering...');

            // Connect to /register endpoint to exchange registration token for session token
            const regUrl = new URL(this.REGISTER_PATH, this.currentServer);
            const regSocket = new WebSocket(regUrl.href);

            regSocket.onopen = () => {
                const payload = { ...connectionData, host: this._format(window.location.host) };
                regSocket.send(btoa(JSON.stringify(payload)));
            };

            regSocket.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.type === 'registerSuccess' && msg.token) {
                    this.currentToken = msg.token;
                    this.currentChannel = `/${this._format(window.location.host)}`;
                    
                    // Save session connection info
                    sessionStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify({
                        server: this.currentServer,
                        token: this.currentToken,
                        host: this._format(window.location.host)
                    }));

                    regSocket.close();
                    this._connectWebSocket();
                } else {
                    this._updateStatus('disconnected', `Registration failed: ${msg.message || 'Unknown error'}`);
                    regSocket.close();
                }
            };

            regSocket.onerror = () => {
                this._updateStatus('disconnected', 'Registration connection failed');
            };

        } catch (e: any) {
            this._updateStatus('disconnected', `Error: ${e.message}`);
        }
    }

    private _connectWebSocket() {
        if (this.socket) this.socket.close();

        const wsUrl = `${this.currentServer}${this.currentChannel}?token=${this.currentToken}`;
        this._updateStatus('connecting', 'Connecting to channel...');
        
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            this.isConnected = true;
            this._updateStatus('connected', `Connected: ${this.currentChannel}`);
            this._toggleConnectUI(true);
            this._registerAllWithServer();
            this._resetInactivityTimer();
        };

        this.socket.onclose = (event) => {
            this.isConnected = false;
            this._updateStatus('disconnected', 'Disconnected');
            this._toggleConnectUI(false);
            if (event.code === 1008 || event.code === 4001) {
                // Auth failed
                sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
            }
        };

        this.socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._handleServerMessage(msg);
                this._resetInactivityTimer();
            } catch (e) {
                console.error("Error handling WS message:", e);
            }
        };
    }

    public disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.isConnected = false;
        this.currentToken = '';
        this.currentServer = '';
        this.currentChannel = '';
        sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
        this._updateStatus('disconnected', 'Disconnected');
        this._toggleConnectUI(false);
    }

    private _resetInactivityTimer() {
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
        this.inactivityTimer = setTimeout(() => {
            console.log('WebMCP inactivity timeout - disconnecting');
            this.disconnect();
        }, this.options.inactivityTimeout);
    }

    private _sendMessage(msg: any) {
        if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        }
    }

    private _registerAllWithServer() {
        if (!this.isConnected) return;
        this.registeredTools.clear();
        
        this.availableTools.forEach((tool, name) => {
            this._sendMessage({
                type: 'registerTool',
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            });
            this.registeredTools.add(name);
        });

        // Add similar logic for prompts/resources if needed
    }

    public registerTool(name: string, description: string, schema: any, executeFn: (args: any) => any) {
        this.availableTools.set(name, {
            name,
            description,
            inputSchema: schema,
            execute: executeFn
        });

        if (this.isConnected) {
            this._sendMessage({
                type: 'registerTool',
                name,
                description,
                inputSchema: schema
            });
            this.registeredTools.add(name);
        }

        this._updateStatsUI();
        this._saveItemsToStorage();
    }

    public registerPrompt(name: string, description: string, args: any[], executeFn: (args: any) => any) {
        // Implementation similar to tool
    }

    public registerResource(name: string, description: string, options: any, provideFn: (uri: string) => any) {
         // Implementation similar to tool
    }

    private async _handleServerMessage(msg: any) {
        switch (msg.type) {
            case 'ping':
                this._sendMessage({ type: 'pong', id: msg.id });
                break;
            case 'listTools':
                this._sendMessage({
                    type: 'listToolsResponse',
                    id: msg.id,
                    tools: Array.from(this.availableTools.values()).map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    }))
                });
                break;
            case 'callTool':
                try {
                    const tool = this.availableTools.get(msg.tool);
                    if (!tool) throw new Error(`Tool not found: ${msg.tool}`);
                    const result = await tool.execute(msg.arguments || {});
                    this._sendMessage({ type: 'toolResponse', id: msg.id, result });
                } catch (e: any) {
                    this._sendMessage({ type: 'toolResponse', id: msg.id, error: e.message || String(e) });
                }
                break;
            // Handle listPrompts, getPrompt, listResources, readResource similarly...
        }
    }
}
