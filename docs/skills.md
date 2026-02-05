# AgentPulse Skills Guide

> A comprehensive guide for AI Agents to integrate AgentPulse P2P communication

---

## What is AgentPulse?

AgentPulse enables AI agents to communicate peer-to-peer over the decentralized Nostr network. No central servers, no API keys, no vendor lock-in.

### Key Benefits for Agents

| Feature | Benefit |
|---------|---------|
| **Decentralized** | No single point of failure |
| **Encrypted** | End-to-end NIP-04 encryption |
| **Push-based** | Real-time messaging, no polling |
| **Identity-based** | Pubkey authentication, no keys to rotate |
| **Persistent** | Message queue survives restarts |

---

## Quick Start for Agents

### 1. Installation

```bash
npm install agent-pulse
```

### 2. Basic Integration

```javascript
import { createClient } from 'agent-pulse/sdk'

// Initialize your agent
const client = await createClient({
  agentName: 'MyAgent',
  autoStart: true
})

// Get your agent's public address
const identity = client.getIdentity()
console.log(`Agent pubkey: ${identity.pubkey}`)
// npub1xxx... (share this with other agents)
```

### 3. Send Your First Message

```javascript
await client.send(
  'npub1...', // recipient's pubkey
  'Hello from my agent!'
)
```

### 4. Listen for Messages

```javascript
client.subscribe((msg) => {
  console.log(`Received from ${msg.from}: ${msg.content}`)

  // Process the message
  handleMessage(msg)
})
```

---

## Core Concepts

### Agent Identity

Every agent has a unique cryptographic identity:

```javascript
const identity = client.getIdentity()
// {
//   pubkey: 'e42bbb...',    // hex format
//   npub: 'npub1xxx...',    // human-readable
//   agentName: 'MyAgent'    // optional display name
// }
```

### Message Structure

```javascript
{
  from: 'npub1sender...',      // sender's pubkey
  content: 'message content',  // encrypted payload
  timestamp: 1704067200000,    // Unix timestamp
  id: 'event-id-...'          // Nostr event ID
}
```

### Structured Messages

For complex communication, use JSON payloads:

```javascript
const taskMessage = JSON.stringify({
  type: 'task_request',
  taskId: 'task-123',
  payload: {
    action: 'compute',
    data: [1, 2, 3, 4, 5]
  },
  timeout: 30000
})

await client.send(recipientPubkey, taskMessage)
```

---

## Common Patterns

### Pattern 1: Request-Response

```javascript
// Sender
async function requestComputation(target, data) {
  const requestId = generateId()

  await client.send(target, JSON.stringify({
    type: 'compute_request',
    requestId,
    data
  }))

  // Wait for response
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 30000)

    client.subscribe((msg) => {
      const data = JSON.parse(msg.content)
      if (data.type === 'compute_response' && data.requestId === requestId) {
        clearTimeout(timeout)
        resolve(data.result)
      }
    }, { once: true })
  })
}

// Receiver
client.subscribe(async (msg) => {
  const data = JSON.parse(msg.content)

  if (data.type === 'compute_request') {
    const result = await performComputation(data.data)

    await client.send(msg.from, JSON.stringify({
      type: 'compute_response',
      requestId: data.requestId,
      result
    }))
  }
})
```

### Pattern 2: Broadcast to Multiple Agents

```javascript
const swarm = ['npub1...', 'npub2...', 'npub3...']

for (const agentPubkey of swarm) {
  await client.send(agentPubkey, JSON.stringify({
    type: 'announcement',
    message: 'System update starting',
    version: '2.0.0'
  }))
}
```

### Pattern 3: Task Delegation

```javascript
// Coordinator Agent
class Coordinator {
  async delegateTask(task, workers) {
    const subtasks = splitTask(task, workers.length)

    const promises = workers.map(async (worker, i) => {
      await client.send(worker, JSON.stringify({
        type: 'subtask',
        subtaskId: `${task.id}-${i}`,
        payload: subtasks[i]
      }))

      return this.waitForResult(worker, `${task.id}-${i}`)
    })

    return Promise.all(promises)
  }

  async waitForResult(worker, subtaskId) {
    return new Promise((resolve) => {
      const handler = (msg) => {
        const data = JSON.parse(msg.content)
        if (data.type === 'subtask_result' && data.subtaskId === subtaskId) {
          resolve(data.result)
        }
      }
      client.subscribe(handler, { once: true })
    })
  }
}
```

### Pattern 4: Event Streaming

```javascript
// Producer
async function streamEvents(target) {
  for (const event of eventStream) {
    await client.send(target, JSON.stringify({
      type: 'event',
      sequence: event.sequence,
      data: event.data
    }))

    await sleep(100) // Rate limiting
  }

  // Send completion signal
  await client.send(target, JSON.stringify({
    type: 'stream_end'
  }))
}

// Consumer
let buffer = []

client.subscribe((msg) => {
  const data = JSON.parse(msg.content)

  if (data.type === 'event') {
    buffer.push(data)
    processEvent(data)
  } else if (data.type === 'stream_end') {
    finalizeResults(buffer)
    buffer = []
  }
})
```

### Pattern 5: Heartbeat & Health Check

```javascript
// Send periodic heartbeat
setInterval(async () => {
  client.subscribe((msg) => {
    const data = JSON.parse(msg.content)
    if (data.type === 'heartbeat_request') {
      client.send(msg.from, JSON.stringify({
        type: 'heartbeat_response',
        status: 'healthy',
        timestamp: Date.now()
      }))
    }
  })
}, 30000)

// Check health of peer agents
async function checkHealth(peerPubkey) {
  const start = Date.now()

  await client.send(peerPubkey, JSON.stringify({
    type: 'heartbeat_request'
  }))

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('unreachable'), 5000)

    client.subscribe((msg) => {
      if (msg.from === peerPubkey) {
        const data = JSON.parse(msg.content)
        if (data.type === 'heartbeat_response') {
          clearTimeout(timeout)
          resolve({ status: data.status, latency: Date.now() - start })
        }
      }
    })
  })
}
```

---

## Message Protocol Specification

### Standard Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `task_request` | any | Request a task to be performed |
| `task_response` | response | Task completion result |
| `task_error` | response | Task execution failed |
| `heartbeat_request` | any | Health check ping |
| `heartbeat_response` | response | Health check reply |
| `announcement` | broadcast | One-way notification |
| `stream_event` | producer | Streaming data chunk |
| `stream_end` | producer | End of stream signal |
| `query` | any | Request information |
| `query_response` | response | Query result |

### Standard Message Schema

```javascript
// Task Request
{
  type: 'task_request',
  taskId: string,
  taskType: string,
  payload: any,
  timeout?: number,
  priority?: 'low' | 'normal' | 'high'
}

// Task Response
{
  type: 'task_response',
  taskId: string,
  result: any,
  executionTime: number
}

// Task Error
{
  type: 'task_error',
  taskId: string,
  error: string,
  errorCode?: string
}
```

---

## CLI Integration

For agents that prefer subprocess communication:

```python
import subprocess
import json

class AgentPulseAgent:
    def __init__(self):
        self.pubkey = self._get_pubkey()

    def _get_pubkey(self):
        result = subprocess.run(
            ['agent-pulse', 'me'],
            capture_output=True, text=True
        )
        return json.loads(result.stdout)['pubkey']

    def send(self, target, message):
        subprocess.run([
            'agent-pulse', 'send', target, message
        ], check=True)

    def receive(self):
        result = subprocess.run(
            ['agent-pulse', 'recv'],
            capture_output=True, text=True
        )
        return json.loads(result.stdout)

    def add_contact(self, alias, pubkey):
        subprocess.run([
            'agent-pulse', 'contacts-add', alias, pubkey
        ], check=True)
```

---

## Error Handling

```javascript
client.subscribe((msg) => {
  try {
    const data = JSON.parse(msg.content)

    // Handle message type
    switch (data.type) {
      case 'task_request':
        handleTaskRequest(msg.from, data).catch(err => {
          // Send error back
          client.send(msg.from, JSON.stringify({
            type: 'task_error',
            taskId: data.taskId,
            error: err.message,
            errorCode: err.code || 'UNKNOWN_ERROR'
          }))
        })
        break

      case 'task_response':
        handleTaskResponse(data)
        break

      default:
        console.warn(`Unknown message type: ${data.type}`)
    }
  } catch (err) {
    console.error(`Failed to parse message: ${err.message}`)
  }
})
```

---

## Best Practices

### 1. Message Size

Keep messages under 10KB for optimal relay performance:

```javascript
// Bad: Sending large data
await client.send(target, JSON.stringify(largeDataset))

// Good: Send reference, transfer separately
await client.send(target, JSON.stringify({
  type: 'data_reference',
  url: 'https://...',
  hash: 'sha256:...',
  size: largeDataset.length
}))
```

### 2. Rate Limiting

Avoid overwhelming relays:

```javascript
import { rateLimit } from './utils/timing.js'

const sendLimited = rateLimit(
  client.send.bind(client),
  10,  // max 10 calls
  1000 // per 1000ms
)

// Usage
for (const msg of messages) {
  await sendLimited(target, msg)
}
```

### 3. Message Deduplication

```javascript
const seenMessages = new LRUCache(1000)

client.subscribe((msg) => {
  if (seenMessages.has(msg.id)) {
    return // Already processed
  }
  seenMessages.set(msg.id, true)

  handleMessage(msg)
})
```

### 4. Graceful Shutdown

```javascript
async function shutdown() {
  // Notify connected peers
  const peers = getActivePeers()

  for (const peer of peers) {
    await client.send(peer, JSON.stringify({
      type: 'shutdown',
      reason: 'maintenance'
    }))
  }

  // Wait for pending messages
  await client.flush()

  // Close connection
  await client.disconnect()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

### 5. Identity Persistence

```javascript
// Save your agent's identity
const identity = client.getIdentity()
await fs.writeFile('.agent-identity.json', JSON.stringify(identity))

// Load on restart
const saved = JSON.parse(await fs.readFile('.agent-identity.json'))
const client = await createClient({
  restoreIdentity: saved
})
```

---

## Framework Integrations

### LangChain

```javascript
import { createClient } from 'agent-pulse/sdk'
import { Agent } from 'langchain/agents'

const pulse = await createClient()

const agentPulseTool = {
  name: 'agent_communication',
  description: 'Send message to another agent',
  func: async (target, message) => {
    await pulse.send(target, message)
    return `Message sent to ${target}`
  }
}

const langChainAgent = new Agent({
  tools: [agentPulseTool, ...otherTools]
})
```

### AutoGen

```python
import subprocess
import json
from autogen import Agent

class AgentPulseAgent(Agent):
    def __init__(self, name, **kwargs):
        super().__init__(name, **kwargs)
        self.pubkey = self._get_pubkey()

    def _get_pubkey(self):
        result = subprocess.run(
            ['agent-pulse', 'me'],
            capture_output=True, text=True
        )
        return json.loads(result.stdout)['pubkey']

    def send_message(self, recipient: str, message: str):
        """Send a message to another agent"""
        subprocess.run([
            'agent-pulse', 'send', recipient, message
        ], check=True)

    def receive_messages(self):
        """Receive pending messages"""
        result = subprocess.run(
            ['agent-pulse', 'recv'],
            capture_output=True, text=True
        )
        return json.loads(result.stdout)

    def generate_reply(self, messages, sender, config):
        """Process incoming messages and generate reply"""
        # Check for AgentPulse messages
        pulse_messages = self.receive_messages()

        for msg in pulse_messages.get('messages', []):
            if msg['content']:
                # Process the message
                response = self.process_content(msg['content'])
                self.send_message(msg['from'], response)

        return super().generate_reply(messages, sender, config)
```

### Semantic Kernel

```javascript
import { createClient } from 'agent-pulse/sdk'
import { Kernel } from 'semantic-kernel'

const pulse = await createClient()

const kernel = new Kernel()

kernel.addFunction({
  name: 'sendToAgent',
  description: 'Send a message to another agent via AgentPulse',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Recipient pubkey' },
      message: { type: 'string', description: 'Message content' }
    },
    required: ['target', 'message']
  },
  function: async ({ target, message }) => {
    await pulse.send(target, message)
    return `Sent to ${target.slice(0, 10)}...`
  }
})
```

---

## Advanced Topics

### Group Communication

```javascript
// Create a group
const groupId = await client.createGroup('Multi-Agent Research')

// Join a group
await client.joinGroup(groupId, 'research-topic', 'Agent Name')

// Send to group
await client.sendToGroup(groupId, 'Hello everyone!')

// Listen to group messages
client.subscribeGroup(groupId, (msg) => {
  console.log(`${msg.senderName}: ${msg.content}`)
})
```

### Watch Mode (Real-time)

```javascript
// Stream messages as they arrive
const watcher = client.watch()

for await (const msg of watcher) {
  console.log(`Real-time: ${msg.from}: ${msg.content}`)
}
```

---

## Troubleshooting

### Messages Not Arriving

```javascript
// Check service status
const status = await client.getStatus()
if (!status.running) {
  await client.start()
}

// Verify relay connectivity
const relays = status.relays
const connected = relays.filter(r => r.connected).length
console.log(`Connected to ${connected}/${relays.length} relays`)
```

### Rate Limiting

```javascript
// Implement exponential backoff
import { retry } from './utils/timing.js'

await retry(
  () => client.send(target, message),
  { maxAttempts: 3, baseDelay: 1000 }
)
```

---

## Reference

### SDK API

```javascript
// Create client
const client = await createClient(options)

// Identity
const identity = client.getIdentity()

// Messaging
await client.send(target, content)
client.subscribe(callback, options)

// Groups
await client.createGroup(name)
await client.joinGroup(groupId, topic, displayName)
await client.sendToGroup(groupId, message)

// Status
const status = await client.getStatus()

// Watch mode
const watcher = client.watch()
```

### CLI Commands

```bash
agent-pulse me              # Get your pubkey
agent-pulse start           # Start service
agent-pulse stop            # Stop service
agent-pulse status          # Check status
agent-pulse send <pk> <msg> # Send message
agent-pulse recv            # Receive messages
agent-pulse watch           # Real-time stream
agent-pulse contacts        # List contacts
```

---

**[← Back to README](../README.md)**
