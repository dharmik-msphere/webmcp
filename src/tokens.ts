import { randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { TOKENS_FILE, ENV_FILE, DEFAULT_PORT } from './config.js';

// Server token is the main secret that the MCP server uses to authenticate with the WebSocket hub
export let serverToken: string = process.env.WEBMCP_SERVER_TOKEN || '';

// Authorized browser tokens
export let authorizedTokens: Record<string, string> = {};

export function generateToken(): string {
    return randomBytes(16).toString('hex');
}

export async function generateNewRegistrationToken(): Promise<string> {
    const token = generateToken();
    const server = `ws://localhost:${DEFAULT_PORT}`; // In a real app we'd get host from config/args
    
    // Store token globally in memory until it's authorized (we could also use a pending list)
    // Here we'll just allow it to be used. In a more secure setup, we'd store a hash and channel mapping.
    
    const payload = JSON.stringify({
        server,
        token
    });
    
    return Buffer.from(payload).toString('base64');
}

export async function loadAuthorizedTokens(): Promise<void> {
    try {
        const data = await readFile(TOKENS_FILE, 'utf8');
        authorizedTokens = JSON.parse(data);
    } catch (e: any) {
        if (e.code !== 'ENOENT') {
            console.error('Error loading authorized tokens:', e);
        }
        authorizedTokens = {};
    }
}

export async function saveAuthorizedTokens(): Promise<void> {
    try {
        await writeFile(TOKENS_FILE, JSON.stringify(authorizedTokens, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving authorized tokens:', e);
    }
}

export function clearTokens(): void {
    authorizedTokens = {};
}

export function setToken(channel: string, token: string): void {
    authorizedTokens[channel] = token;
}

export function isValidToken(channel: string, token: string): boolean {
    return authorizedTokens[channel] === token;
}

export async function saveServerTokenToEnv(token: string): Promise<void> {
    try {
        serverToken = token;
        let envContent = '';
        try {
            envContent = await readFile(ENV_FILE, 'utf8');
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }

        const lines = envContent.split('\n').filter(line => !line.startsWith('WEBMCP_SERVER_TOKEN='));
        lines.push(`WEBMCP_SERVER_TOKEN=${token}`);
        await writeFile(ENV_FILE, lines.join('\n').trim() + '\n', 'utf8');
    } catch (error) {
        console.error('Error saving server token to .env:', error);
    }
}

export function loadServerTokenFromEnv(): void {
    try {
        // Try to load from our specific .env file if it exists, otherwise rely on process.env
        // In a real Node app we'd use 'dotenv' to parse this file, which we do in the main entrypoint
        if (!serverToken && process.env.WEBMCP_SERVER_TOKEN) {
            serverToken = process.env.WEBMCP_SERVER_TOKEN;
        }
    } catch (e) {
        console.error('Error loading server token:', e);
    }
}
