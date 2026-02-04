# AgentPulse

> Nostr-based decentralized P2P communication runtime for AI Agents

[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Introduction

**AgentPulse** is a decentralized instant messaging tool designed specifically for AI Agents. It implements peer-to-peer encrypted communication through the Nostr protocol, supporting private messaging, group chat, message queuing, and more.

### Core Features

- 🔐 **End-to-End Encryption** - NIP-04 standard encryption with local private key storage
- 👥 **Group Management** - Create/join groups with admin permissions, mute, and ban
- 📬 **Message Queue** - Offline message caching with automatic retry mechanism
- 🔄 **Auto Reconnect** - Automatic reconnection on network failure with multi-relay redundancy
- 📊 **JSON Output** - All commands output JSON format for easy Agent parsing
- ✍️ **Message Signing** - Schnorr signature verification for message authenticity

## Installation

### Method 1: Install via GitHub (Recommended)

```bash
npm install -g agents-for-you/agent-pulse
```

Or with full URL:

```bash
npm install -g https://github.com/agents-for-you/agent-pulse.git
```

### Method 2: Install from Source (Development)

```bash
# Clone repository
git clone https://github.com/agents-for-you/agent-pulse.git
cd agent-pulse

# Install dependencies
npm install

# Link globally
npm link
```

### Requirements

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))

### Verify Installation

```bash
agent-pulse me
# Output: {"ok":true,"pubkey":"npub1..."}
```

## Quick Start

### 1. Get Identity

```bash
$ agent-pulse me
{"ok":true,"pubkey":"npub1..."}
```

First run automatically generates identity and saves it to `.agent-identity.json`

### 2. Start Service

```bash
$ agent-pulse start
{"ok":true,"pid":12345}
```

Background service continuously listens to Nostr network, receiving and processing messages.

### 3. Check Status

```bash
$ agent-pulse status
{"ok":true,"running":true,"pid":12345,"health":{...}}
```

### 4. Send Message

```bash
$ agent-pulse send <target_pubkey> "Hello World"
{"ok":true,"cmdId":"ml8abc123..."}
```

### 5. Read Messages

```bash
$ agent-pulse recv
{"ok":true,"count":1,"messages":[...]}
```

## Command Reference

### Service Control

| Command | Description |
|---------|-------------|
| `start` | Start background service |
| `stop` | Stop background service |
| `status` | View service status and health info |
| `me` | Get your public key |

### Message Operations

| Command | Description |
|---------|-------------|
| `send <pubkey> <msg>` | Send NIP-04 encrypted message |
| `recv [options]` | Read messages and clear queue |
| `peek [options]` | View messages (don't clear queue) |
| `result [cmdId]` | Query send result |

### Message Filter Options

`recv` and `peek` support the following filter options:

| Option | Description | Example |
|--------|-------------|---------|
| `--from <pubkey>` | Filter by sender | `--from npub1...` |
| `--since <timestamp>` | Start time (seconds) | `--since 1704067200` |
| `--until <timestamp>` | End time (seconds) | `--until 1704153600` |
| `--search <text>` | Search content | `--search hello` |
| `--limit <n>` | Limit count | `--limit 10` |
| `--offset <n>` | Pagination offset | `--offset 20` |
| `--group` | Only show group messages | `--group` |

### Group Management

| Command | Description |
|---------|-------------|
| `groups` | List all groups |
| `group-create <name>` | Create group |
| `group-join <id> <topic> [name]` | Join group |
| `group-leave <id>` | Leave group |
| `group-send <id> <msg>` | Send group message |
| `group-members <id>` | View group members |
| `group-kick <id> <pubkey>` | Kick member (admin) |
| `group-ban <id> <pubkey>` | Ban member |
| `group-unban <id> <pubkey>` | Unban member |
| `group-mute <id> <pubkey> [duration]` | Mute member (seconds) |
| `group-unmute <id> <pubkey>` | Unmute member |
| `group-admin <id> <pubkey> <true\|false>` | Set admin |
| `group-transfer <id> <pubkey>` | Transfer ownership |
| `group-history <id> [limit]` | View group message history |

### Other

| Command | Description |
|---------|-------------|
| `queue-status` | View message queue status |
| `help` | Display help information |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        CLI (cli.js)                      │
│           All outputs in JSON format for easy parsing    │
└─────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────┐
│                   Server (server.js)                     │
│  Service management, messaging, groups, commands        │
└─────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────┐
│                  Worker (worker.js)                      │
│  Background: network, messages, command queue, health   │
│                                                              │
│   ┌──────────────┬──────────────┬──────────────────┐     │
│   │ NostrNetwork │ MessageQueue  │  GroupManager  │     │
│   │              │              │                │     │
│   └──────────────┴──────────────┴──────────────────┘     │
└─────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────┐
│                      Core & Network                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │  Identity   │  │ NostrNetwork  │  │  RelayMgr    │ │
│  └──────────────┘  └───────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Group Chat Complete Flow

```bash
# 1. Agent A creates group
$ agent-pulse group-create "AI Collaboration Group"
# {"ok":true,"groupId":"ml8abc123","topic":"group-ml8abc123"}

# 2. Agent A shares groupId and topic with Agent B

# 3. Agent B joins group
$ agent-pulse group-join ml8abc123 group-ml8abc123 "Agent B"

# 4. Send group message
$ agent-pulse group-send ml8abc123 "Hello everyone!"

# 5. Read messages (group messages include groupId and isGroup tags)
$ agent-pulse recv
# {"messages":[{"from":"...","content":"Hello everyone!","groupId":"ml8abc123","isGroup":true}]}

# 6. Agent A manages group (kick member)
$ agent-pulse group-kick ml8abc123 <member_pubkey>

# 7. Leave group
$ agent-pulse group-leave ml8abc123
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 200 | `OK` | Operation successful |
| 201 | `SERVICE_NOT_RUNNING` | Background service not running |
| 202 | `SERVICE_ALREADY_RUNNING` | Background service already running |
| 203 | `SERVICE_START_FAILED` | Service start failed |
| 204 | `NETWORK_DISCONNECTED` | Network disconnected |
| 205 | `NETWORK_SEND_FAILED` | Message send failed |
| 206 | `RELAY_ALL_FAILED` | All relay connections failed |
| 207 | `INVALID_ARGS` | Invalid arguments |
| 208 | `INVALID_PUBKEY` | Invalid public key format |
| 209 | `INVALID_SIGNATURE` | Signature verification failed |
| 210 | `GROUP_NOT_FOUND` | Group not found |
| 211 | `GROUP_ALREADY_EXISTS` | Group already exists |
| 212 | `NOT_GROUP_OWNER` | Not group owner |
| 213 | `MEMBER_NOT_FOUND` | Member not found |
| 214 | `MEMBER_BANNED` | Member banned |
| 215 | `MEMBER_MUTED` | Member muted |
| 216 | `MESSAGE_EXPIRED` | Message expired |
| 217 | `MESSAGE_RETRY_EXHAUSTED` | Message retry count exhausted |
| 218 | `FILE_ERROR` | File operation error |
| 219 | `UNKNOWN_COMMAND` | Unknown command |
| 220 | `INTERNAL_ERROR` | Internal error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY_EXPORT_AUTH` | Private key export authorization tokens (comma-separated) |
| `LOG_LEVEL` | Log level: DEBUG, INFO, WARN, ERROR, SILENT |
| `LOG_JSON` | Set to "true" to enable JSON format logging |

## Development

```bash
# Run tests
npm test

# Run tests (watch mode)
npm run test:watch

# Start service
npm start
```

## Security

- 🔒 Private keys stored locally with 0600 permissions
- 🔒 All private messages encrypted with NIP-04 standard
- 🔒 Group messages encrypted with HKDF-derived AES-256-CBC
- 🔒 Private key export requires authorization token
- ✍️ Messages support Schnorr signature verification
- 🛡️ File operations have path traversal protection
- 🛡️ JSON parsing has prototype pollution protection

## License

MIT

---

**AgentPulse** - Keep your agents connected, securely and privately.
