# AgentPulse Docker Makefile
# Convenient commands for Docker-based development and testing

.PHONY: help build up down restart logs status test test-interactive clean shell

# Default target
help:
	@echo "AgentPulse Docker Commands:"
	@echo ""
	@echo "  make build              - Build the Docker image"
	@echo "  make up                 - Start all agents (docker-compose up)"
	@echo "  make down               - Stop all agents (docker-compose down)"
	@echo "  make restart            - Restart all agents"
	@echo "  make logs               - View logs from all agents"
	@echo "  make logs-agent-N       - View logs from agent N (e.g., make logs-agent-1)"
	@echo "  make status             - Show status of all agents"
	@echo "  make shell-N            - Open shell in agent N (e.g., make shell-1)"
	@echo "  make test               - Run integration tests"
	@echo "  make test-interactive   - Run tests with interactive output"
	@echo "  make clean              - Remove all containers, volumes, and images"
	@echo ""

# Build the Docker image
build:
	docker-compose build

# Start all agents
up:
	docker-compose up -d
	@echo "Waiting for agents to start..."
	@sleep 5
	@$(MAKE) status

# Stop all agents
down:
	docker-compose down

# Restart all agents
restart: down up

# View logs from all agents
logs:
	docker-compose logs -f

# View logs from specific agent
logs-agent-1:
	docker-compose logs -f agent-pulse-1

logs-agent-2:
	docker-compose logs -f agent-pulse-2

logs-agent-3:
	docker-compose logs -f agent-pulse-3

# Show status of all agents
status:
	@echo "=== Agent Status ==="
	@docker-compose ps
	@echo ""
	@echo "=== Health Check ==="
	@docker-compose exec -T agent-pulse-1 node index.js status 2>/dev/null || echo "Agent 1: Not running"
	@docker-compose exec -T agent-pulse-2 node index.js status 2>/dev/null || echo "Agent 2: Not running"
	@docker-compose exec -T agent-pulse-3 node index.js status 2>/dev/null || echo "Agent 3: Not running"

# Open shell in specific agent
shell-1:
	docker-compose exec agent-pulse-1 sh

shell-2:
	docker-compose exec agent-pulse-2 sh

shell-3:
	docker-compose exec agent-pulse-3 sh

# Run integration tests
test:
	docker-compose -f test/docker/docker-compose.test.yml up --build --abort-on-container-exit

# Run tests with interactive output
test-interactive:
	docker-compose -f test/docker/docker-compose.test.yml up --build

# Clean up everything
clean: down
	docker volume rm agent-pulse-data-1 agent-pulse-data-2 agent-pulse-data-3 2>/dev/null || true
	docker volume rm agent-pulse-test-data agent-pulse-test-data-1 agent-pulse-test-data-2 agent-pulse-test-data-3 2>/dev/null || true
	docker volume rm agent-pulse-test-results 2>/dev/null || true
	docker network rm agent-pulse-network agent-pulse-test-network 2>/dev/null || true
	@echo "Cleanup complete"

# Pull latest base image
pull:
	docker pull node:20-alpine
