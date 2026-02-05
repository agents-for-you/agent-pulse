# AgentPulse Demo Gallery

> Interactive demonstrations showcasing AI agent communication over Nostr P2P network

---

## What You'll See

These demos demonstrate **real-world multi-agent scenarios** using AgentPulse:

| Demo | Description | Agents | Complexity |
|------|-------------|--------|------------|
| `chat-demo` | Simple 1-on-1 agent conversation | 2 | Beginner |
| `task-coordination` | Coordinated task delegation | 3 | Intermediate |
| `swarm-intelligence` | Collective decision making | 5 | Advanced |

---

## Quick Start

### Prerequisites

```bash
# Install AgentPulse globally (if not already installed)
npm install -g ../

# Install demo dependencies
npm install
```

### Running Demos

#### Demo 1: Chat Demo (Beginner)

Two agents having a simple conversation:

```bash
npm run demo:chat
```

**Output Preview:**
```
┌─────────────────────────────────────────────────────────┐
│              AgentPulse Chat Demo                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  🔵 Agent A (Alice)      🔴 Agent B (Bob)               │
│                                                          │
│  [10:00:01] Alice:  Hello Bob!                          │
│             →                                          │
│  [10:00:02] Bob:    Hi Alice! How can I help?           │
│             ←                                          │
│  [10:00:03] Alice:  I need help with a calculation...   │
│             →                                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Demo 2: Task Coordination (Intermediate)

Three agents coordinating on a data processing pipeline:

```bash
npm run demo:coordination
```

**Scenario:**
- **Coordinator Agent**: Delegates tasks and aggregates results
- **Worker Agent 1**: Processes numerical data
- **Worker Agent 2**: Processes text data

#### Demo 3: Swarm Intelligence (Advanced)

Five agents performing collective decision-making:

```bash
npm run demo:swarm
```

**Features:**
- Leader election protocol
- Distributed voting
- Consensus building
- Fault tolerance simulation

---

## How It Works

Each demo uses the AgentPulse SDK:

```javascript
import { createClient } from 'agent-pulse/sdk'

// Create agent with personality
const client = await createClient()

// Listen for messages
client.subscribe((msg) => {
  const data = JSON.parse(msg.content)
  handleAgentMessage(data)
})

// Send structured messages
await client.send(targetPubkey, JSON.stringify({
  type: 'task_proposal',
  payload: { ... }
}))
```

---

## Customization

### Create Your Own Demo

1. Copy an existing scenario as template:

```bash
cp scenarios/chat-demo.js scenarios/my-demo.js
```

2. Modify agent personalities in `agents/`:

```javascript
// agents/my-agent.js
export const personality = {
  name: 'MyAgent',
  systemPrompt: 'You are a helpful assistant...',
  responsePattern: /hello/i,
  handler: (msg) => { /* ... */ }
}
```

3. Add to `package.json` scripts:

```json
{
  "scripts": {
    "demo:my": "node scenarios/my-demo.js"
  }
}
```

---

## Architecture

```
demo/
├── scenarios/           # Demo scenarios
│   ├── chat-demo.js
│   ├── task-coordination.js
│   └── swarm-intelligence.js
├── agents/             # Agent personalities
│   ├── alice.js
│   ├── bob.js
│   └── coordinator.js
├── utils/              # Shared utilities
│   ├── display.js      # Pretty console output
│   └── timing.js       # Delay helpers
├── package.json
└── README.md
```

---

## Troubleshooting

### Messages not received?

```bash
# Check AgentPulse service status
agent-pulse status

# Restart if needed
agent-pulse stop && agent-pulse start
```

### Agents not connecting?

Verify relay connectivity:

```bash
agent-pulse recv
```

---

## Extending the Demos

### Integration with AutoGen

```javascript
// Python-style pseudocode
import { createClient } from 'agent-pulse/sdk'

const pulse = await createClient()

// Bridge to AutoGen agents
class AutoGenBridge {
  async sendMessage(to, message) {
    await pulse.send(to, JSON.stringify({
      type: 'autogen',
      message
    }))
  }

  onMessage(callback) {
    pulse.subscribe((msg) => {
      const data = JSON.parse(msg.content)
      if (data.type === 'autogen') {
        callback(data.message)
      }
    })
  }
}
```

### Integration with LangChain

```javascript
import { createClient } from 'agent-pulse/sdk'

const pulse = await createClient()

// Agent as a LangChain tool
export const agentPulseTool = {
  name: 'agent_communication',
  description: 'Send message to another agent via AgentPulse',
  func: async (target, message) => {
    await pulse.send(target, message)
    return `Message sent to ${target}`
  }
}
```

---

## Contributing

Have a cool demo idea? Contributions welcome!

1. Fork the repository
2. Create your demo scenario
3. Add documentation
4. Submit a PR

---

**[← Back to Main README](../README.md)**
