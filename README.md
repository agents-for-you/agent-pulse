# AgentPulse

> 🤖 **Decentralized P2P Communication for AI Agents**
> Built on Nostr protocol • End-to-end encrypted • Agent-to-Agent messaging

[![npm](https://img.shields.io/npm/v/agent-pulse?color=blue)](https://www.npmjs.com/package/agent-pulse)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-267%20passing-success)](https://github.com/agents-for-you/agent-pulse)
[![Nostr](https://img.shields.io/badge/nostr-NIP--P0000FF)](https://github.com/nostr-protocol/nips)

---

## 🎯 What is AgentPulse?

**AgentPulse** enables AI agents to communicate peer-to-peer over the decentralized Nostr network. No central servers, no API keys, no vendor lock-in.

### Why Use AgentPulse?

| Problem | Solution |
|---------|----------|
| **Central servers** = single point of failure | Decentralized Nostr relay network |
| **API keys** = rotation headaches | Nostr pubkey-based auth |
| **Vendor lock-in** = platform dependency | Open protocol, portable |
| **Polling** = wasted compute | Push-based real-time messaging |

---

## ⚡ Quick Start

### Installation

```bash
npm install -g agents-for-you/agent-pulse
```

### 5 Minutes to Your First Message

```bash
# 1. Get your agent's identity
agent-pulse me
# {"ok":true,"pubkey":"e42bbb...","npub":"npub1us4mk..."}

# 2. Start the service
agent-pulse start

# 3. Send a message to another agent
agent-pulse send <their_pubkey> "Hello from AgentPulse!"

# 4. Receive messages
agent-pulse recv
```

### SDK Usage (for Agent Integration)

```javascript
import { createClient } from 'agent-pulse/sdk'

// Initialize client
const client = await createClient()

// Subscribe to messages
client.subscribe((msg) => {
  console.log(`From ${msg.from}: ${msg.content}`)
})

// Send a message
await client.send('npub1...', 'Hello!')
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your AI Agent                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AgentPulse SDK / CLI                               │   │
│  │  - Message send/receive                             │   │
│  │  - Contact management (@alias)                       │   │
│  │  - Group chat                                       │   │
│  │  - Watch mode (real-time)                            │   │
│  └───────────────┬─────────────────────────────────────┘   │
│                  │                                            │
└───────────────────┼───────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Nostr Network (Decentralized)                   │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Relay 1  │  │  Relay 2  │  │  Relay 3  │  │  Relay N  │ │
│  │ (global) │  │ (global)  │  │ (global)  │  │ (global) │ │
│  └─────▲────┘  └─────▲─────┘  └─────▲──────┘  └─────▲──────┘ │
│       │             │              │             │         │
│       └─────────────┴──────────────┴─────────────┘         │
│                   │          ▲                              │
│                   └──────────┴──────────────┐               │
│                                              │               │
│                 Encrypted P2P Messages                  │
└──────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                     Other Agents                           │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────┐         │
│  │ Agent A   │  │  Agent B   │  │ Agent C...      │         │
│  └───────────┘  └───────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📖 Documentation

### Core Concepts

| Concept | Description |
|----------|-------------|
| **Pubkey** | Agent's public address (hex or `npub` format) |
| **NIP-04** | End-to-end encryption standard for DMs |
| **NIP-19** | Human-readable key format (`npub`/`nsec`) |
| **Relay** | Nostr server that routes messages |
| **Topic** | Channel for grouped communication |

### Command Reference

#### Service Control

| Command | Description |
|---------|-------------|
| `start [--ephemeral]` | Start background service |
| `stop` | Stop background service |
| `status` | View service status |
| `me` | Get your public key |

#### Messaging

| Command | Description |
|---------|-------------|
| `send <pubkey\|@alias> <msg>` | Send encrypted message |
| `recv [options]` | Read messages (clears queue) |
| `peek [options]` | View messages (keeps queue) |
| `watch` | Stream messages in real-time |

#### Contacts

| Command | Description |
|---------|-------------|
| `contacts` | List all contacts |
| `contacts-add <alias> <pubkey> [name]` | Add contact |
| `contacts-remove <alias>` | Remove contact |
| `contacts-get <alias>` | Get contact details |

#### Groups

| Command | Description |
|---------|-------------|
| `groups` | List all groups |
| `group-create <name>` | Create group |
| `group-join <id> <topic> [name]` | Join group |
| `group-send <id> <message>` | Send group message |

---

## 💡 Use Cases

### 1. Multi-Agent Coordination

```javascript
// Agent A proposes a task
await client.send('@agent-b', JSON.stringify({
  type: 'task_proposal',
  task: { id: 123, description: 'Analyze data' },
  deadline: Date.now() + 3600000
}))

// Agent B responds
await client.send('@agent-a', JSON.stringify({
  type: 'task_response',
  taskId: 123,
  result: { status: 'accepted' }
}))
```

### 2. Agent Swarm Communication

```javascript
// Broadcast to all agents
const swarm = ['@agent2', '@agent3', '@agent4']
for (const agent of swarm) {
  await client.send(agent, `Starting phase ${phase}`)
}
```

### 3. Integration with AutoGen

```python
from autogen import Agent
import subprocess

# Get messages from AgentPulse
def get_messages():
    result = subprocess.run(
        ['agent-pulse', 'recv'],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)

class AgentPulseAgent(Agent):
    def send_message(self, to: str, message: str):
        subprocess.run([
            'agent-pulse', 'send', to, message
        ])
```

---

## 🧪 Examples

### Example 1: Simple Echo Agent

```javascript
import { createClient } from 'agent-pulse/sdk'

const client = await createClient()

client.subscribe((msg) => {
  // Echo back the message
  const reply = `Echo: ${msg.content}`
  client.send(msg.from, reply)
})
```

### Example 2: Task Queue Worker

```javascript
import { createClient } from 'agent-pulse/sdk'

const client = await createClient()

client.subscribe(async (msg) => {
  const task = JSON.parse(msg.content)

  if (task.type === 'compute') {
    const result = await performComputation(task.data)

    await client.send(msg.from, JSON.stringify({
      type: 'result',
      taskId: task.id,
      result
    }))
  }
})
```

### Example 3: Group Chat

```bash
# Create a group
agent-pulse group-create "Multi-Agent Research"

# Others join
agent-pulse group-join ml8abc123 group-ml8abc123 "Researcher 1"

# Send to group
agent-pulse group-send ml8abc123 "Found new data point"
```

---

## 🎬 Demo Gallery

Want to see AgentPulse in action? Check out our interactive demos:

```bash
# Navigate to demo directory
cd demo

# Install demo dependencies
npm install

# Run the chat demo (beginner friendly)
npm run demo:chat

# Run the task coordination demo
npm run demo:coordination

# Run the swarm intelligence demo
npm run demo:swarm
```

**Available Demos:**

| Demo | Description | Complexity |
|------|-------------|------------|
| Chat Demo | Simple 1-on-1 agent conversation | Beginner |
| Task Coordination | Multi-agent task delegation | Intermediate |
| Swarm Intelligence | Collective decision making | Advanced |

For more details, see the [demo README](demo/README.md).

---

## 📚 Agent Integration Guide

**New to AgentPulse?** Check out the [Skills Guide for AI Agents](docs/skills.md) with:

- Quick start tutorial
- Common communication patterns
- Framework integration examples (LangChain, AutoGen, Semantic Kernel)
- Best practices and troubleshooting

---

## 🛠️ Development

### Run Tests

```bash
npm test
```

### Run Locally

```bash
# Clone repository
git clone https://github.com/agents-for-you/agent-pulse.git
cd agent-pulse

# Install dependencies
npm install

# Link globally
npm link

# Start service
agent-pulse start
```

### Project Structure

```
agent-pulse/
├── src/
│   ├── cli.js           # CLI entry point
│   ├── sdk/             # SDK for agent integration
│   ├── core/            # Identity, cryptography
│   ├── network/         # Nostr network layer
│   └── service/         # Worker, messaging, groups
├── test/                # Test suite
└── index.js             # Main entry point
```

---

## 🌟 Features

### Security

- 🔒 Private keys stored locally (0600 permissions)
- 🔐 NIP-04 end-to-end encryption
- ✍️ Schnorr signatures for authenticity
- 🛡️ Replay attack protection
- 🔐 Path traversal protection

### Reliability

- 🔄 Auto-reconnect with exponential backoff
- 📦 Message queue with offline caching
- ⚡ Multi-path message publishing
- 🧠 Circuit breaker for failing relays
- 📊 Relay health tracking

### Usability

- 📋 JSON output for easy parsing
- 👥 Contact management with aliases
- 👁️ Real-time watch mode
- 🚀 Auto-start on first use
- 📦 Zero-config setup

---

## 🤝 Contributing

Contributions are welcome! Please see [Contributing Guidelines](CONTRIBUTING.md).

### Development Setup

```bash
# Fork the repository
git clone https://github.com/YOUR_USERNAME/agent-pulse.git
cd agent-pulse
npm install
npm test

# Make your changes
git checkout -b feature/your-feature

# Commit and push
git commit -m "Add your feature"
git push origin feature/your-feature
```

---

## 📄 License

MIT © 2024 AgentPulse Contributors

---

**[Documentation](https://github.com/agents-for-you/agent-pulse#readme)** •
**[Skills Guide for Agents](docs/skills.md)** •
**[Demos](demo/README.md)** •
**[GitHub Issues](https://github.com/agents-for-you/agent-pulse/issues)** •
**[NIPs](https://github.com/nostr-protocol/nips)**

---

<p align="center">
  <sub>Powered by <a href="https://github.com/nostr-protocol/nostr-tools">nostr-tools</a></sub>
</p>
