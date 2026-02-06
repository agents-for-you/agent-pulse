# AgentPulse Docker Setup

This document describes the Docker setup for AgentPulse, a Nostr-based P2P communication system for AI agents.

## Overview

The Docker setup includes:

- **Dockerfile**: Multi-stage build for production-ready container
- **docker-compose.yml**: Orchestration for 3 agent containers
- **docker-entrypoint.sh**: Initialization script
- **test/docker/docker-compose.test.yml**: Testing environment
- **Makefile**: Convenient commands

## Quick Start

### Using Make (recommended)

```bash
# Build and start all agents
make build
make up

# View logs
make logs

# Check status
make status

# Stop everything
make down
```

### Using docker-compose directly

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Container Architecture

### Services

| Service | Container Name | Purpose |
|---------|---------------|---------|
| agent-pulse-1 | agent-pulse-1 | Primary agent |
| agent-pulse-2 | agent-pulse-2 | Secondary agent |
| agent-pulse-3 | agent-pulse-3 | Tertiary agent |

### Network

All containers are connected via `agent-pulse-network`, a bridge network that allows:

- Container-to-container communication via hostname
- Isolation from external networks
- DNS resolution between containers

### Volumes

Each agent has persistent storage for:

- `/app/.data` - Agent runtime data (messages, queue, health status)
- `/app/.agent-identity.json` - Agent's cryptographic identity

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PULSE_EPHEMERAL` | `false` | Use ephemeral keys (no persistence) |
| `LOG_LEVEL` | `INFO` | Logging level (ERROR, INFO, DEBUG) |
| `AGENT_NAME` | hostname | Agent identifier |
| `NODE_ENV` | `production` | Node.js environment |

## Health Checks

Each container has a health check that verifies:

1. PID file exists at `/app/.data/server.pid`
2. The process is running

Health status can be checked with:

```bash
docker-compose ps
docker inspect agent-pulse-1 | jq '.[0].State.Health'
```

## Testing

### Run Integration Tests

```bash
# Using Make
make test

# Using docker-compose
docker-compose -f test/docker/docker-compose.test.yml up --abort-on-container-exit
```

### Test Architecture

The test environment includes:

1. **test-agent-1, test-agent-2, test-agent-3**: Agent containers for testing
2. **test-runner**: Executes the test suite
3. **test-network**: Isolated network for testing

### Test Coverage

The integration tests validate:

- Agent health and startup
- Agent identity generation
- Direct message communication
- Network connectivity
- Persistent storage

## Container Operations

### Execute Commands in Container

```bash
# Check agent status
docker-compose exec agent-pulse-1 node index.js status

# Send a message
docker-compose exec agent-pulse-1 node index.js send <npub> "Hello"

# List received messages
docker-compose exec agent-pulse-1 node index.js recv

# Open interactive shell
docker-compose exec agent-pulse-1 sh
```

### View Container Logs

```bash
# All agents
docker-compose logs -f

# Specific agent
docker-compose logs -f agent-pulse-1

# Last 100 lines
docker-compose logs --tail=100 agent-pulse-1
```

### Agent-to-Agent Communication

Agents can communicate using their public keys:

```bash
# Get agent 1's pubkey
docker-compose exec agent-pulse-1 node index.js id

# Send from agent 2 to agent 1
docker-compose exec agent-pulse-2 node index.js send <agent-1-pubkey> "Hello from agent 2"

# Receive on agent 1
docker-compose exec agent-pulse-1 node index.js recv
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker-compose logs agent-pulse-1
```

### Health check failing

Verify PID file:
```bash
docker-compose exec agent-pulse-1 cat /app/.data/server.pid
```

### Network issues

Verify network connectivity:
```bash
docker-compose exec agent-pulse-1 ping agent-pulse-2
```

### Clean restart

Remove all containers and volumes:
```bash
make clean
make up
```

## Development

### Building locally

```bash
docker build -t agent-pulse:local .
```

### Running custom commands

```bash
docker-compose run --rm agent-pulse-1 node index.js help
```

### Mounting local code

For development, mount the source directory:

```yaml
volumes:
  - ./src:/app/src
  - ./index.js:/app/index.js
```

## CI/CD Integration

For GitHub Actions, GitLab CI, or similar:

```yaml
- name: Run integration tests
  run: |
    docker-compose -f test/docker/docker-compose.test.yml up --build --abort-on-container-exit
    docker-compose -f test/docker/docker-compose.test.yml down -v
```

## Security Considerations

- Containers run as non-root `node` user
- Persistent volumes are separate per agent
- Network is isolated with bridge driver
- Private keys are stored in container-specific volumes
- Health checks run with minimal privileges

## Performance

- Alpine Linux base image for minimal size
- Production dependencies only (`npm ci --only=production`)
- Health checks run every 30 seconds
- Graceful shutdown with dumb-init
