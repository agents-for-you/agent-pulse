#!/bin/sh
set -e

# Docker entrypoint script for AgentPulse
# This script handles initialization before starting the agent

# Default to INFO log level if not set
LOG_LEVEL=${LOG_LEVEL:-INFO}
export LOG_LEVEL

# Default agent name from hostname if not set
AGENT_NAME=${AGENT_NAME:-$(hostname)}
export AGENT_NAME

# Ensure .data directory exists with proper permissions
mkdir -p /app/.data

# If running as non-root (node user), ensure permissions
if [ "$(id -u)" = "1000" ]; then
    # Running as node user, directory should already be writable
    :
fi

# Display startup information
echo "=========================================="
echo "  AgentPulse P2P Communication System"
echo "=========================================="
echo "Agent Name: ${AGENT_NAME}"
echo "Log Level:  ${LOG_LEVEL}"
echo "Ephemeral:  ${AGENT_PULSE_EPHEMERAL:-false}"
echo "Node Env:   ${NODE_ENV:-development}"
echo "=========================================="

# Execute the command passed as arguments
exec "$@"
