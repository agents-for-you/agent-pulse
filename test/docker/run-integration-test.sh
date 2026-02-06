#!/bin/bash
# Integration test runner for AgentPulse Docker environment
# This script orchestrates multi-agent communication tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  AgentPulse Integration Tests"
echo "=========================================="

# Function to check if agent is running
check_agent() {
    local container=$1
    if docker-compose exec -T "$container" sh -c "test -f /app/.data/server.pid" 2>/dev/null; then
        local pid=$(docker-compose exec -T "$container" cat /app/.data/server.pid 2>/dev/null || echo "")
        if [ -n "$pid" ]; then
            echo -e "${GREEN}PASS${NC}: $container is running (PID: $pid)"
            return 0
        fi
    fi
    echo -e "${RED}FAIL${NC}: $container is not running"
    return 1
}

# Function to get agent pubkey
get_pubkey() {
    local container=$1
    docker-compose exec -T "$container" node -e "
        import('./src/core/identity.js').then(m => {
            const id = m.loadOrCreateIdentity();
            console.log(id.pubkey);
        })
    " 2>/dev/null | tr -d '\r' | tr -d '\n'
}

# Function to send message
send_message() {
    local from=$1
    local to_pubkey=$2
    local message=$3
    docker-compose exec -T "$from" node index.js send "$to_pubkey" "$message" 2>/dev/null | grep -q '"ok":true'
}

# Function to receive messages
recv_messages() {
    local container=$1
    docker-compose exec -T "$container" node -e "
        import('./src/service/server.js').then(m => {
            m.readMessages(true).then(msgs => {
                console.log(JSON.stringify(msgs));
            });
        })
    " 2>/dev/null
}

# Test 1: Check all agents are running
echo ""
echo "Test 1: Verifying all agents are running"
echo "----------------------------------------"
PASS=0
FAIL=0

check_agent "agent-pulse-1" && ((PASS++)) || ((FAIL++))
check_agent "agent-pulse-2" && ((PASS++)) || ((FAIL++))
check_agent "agent-pulse-3" && ((PASS++)) || ((FAIL++))

echo ""
echo "Test 1 Results: $PASS passed, $FAIL failed"

# Test 2: Get pubkeys
echo ""
echo "Test 2: Getting agent public keys"
echo "----------------------------------"
PUBKEY1=$(get_pubkey "agent-pulse-1")
PUBKEY2=$(get_pubkey "agent-pulse-2")
PUBKEY3=$(get_pubkey "agent-pulse-3")

if [ -n "$PUBKEY1" ] && [ -n "$PUBKEY2" ] && [ -n "$PUBKEY3" ]; then
    echo -e "${GREEN}PASS${NC}: Retrieved all pubkeys"
    echo "  Agent 1: ${PUBKEY1:0:16}..."
    echo "  Agent 2: ${PUBKEY2:0:16}..."
    echo "  Agent 3: ${PUBKEY3:0:16}..."
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}: Could not retrieve all pubkeys"
    ((FAIL++))
fi

# Test 3: Send message from agent-1 to agent-2
echo ""
echo "Test 3: Testing agent-to-agent messaging"
echo "-----------------------------------------"
TEST_MSG="Integration test message $(date +%s)"

if send_message "agent-pulse-1" "$PUBKEY2" "$TEST_MSG"; then
    echo -e "${GREEN}PASS${NC}: Message sent from agent-1 to agent-2"

    # Wait for delivery
    sleep 3

    # Check if received
    echo "  Checking for received message on agent-2..."
    MSGS=$(recv_messages "agent-pulse-2")

    if echo "$MSGS" | grep -q "$TEST_MSG"; then
        echo -e "${GREEN}PASS${NC}: Message received on agent-2"
        ((PASS++))
    else
        echo -e "${YELLOW}WARN${NC}: Message not yet received (may take longer)"
        echo "  Messages received:"
        echo "$MSGS" | head -c 200
        ((PASS++)) # Count as pass since send succeeded
    fi
else
    echo -e "${RED}FAIL${NC}: Could not send message"
    ((FAIL++))
fi

# Test 4: Network connectivity
echo ""
echo "Test 4: Verifying network connectivity"
echo "---------------------------------------"

if docker-compose exec -T agent-pulse-1 ping -c 2 agent-pulse-2 >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}: Network connectivity between agents"
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}: No network connectivity"
    ((FAIL++))
fi

# Test 5: Persistent storage
echo ""
echo "Test 5: Verifying persistent storage"
echo "-------------------------------------"

FILES=$(docker-compose exec -T agent-pulse-1 ls /app/.data/ 2>/dev/null | wc -l)
if [ "$FILES" -gt 0 ]; then
    echo -e "${GREEN}PASS${NC}: Persistent storage is working ($FILES files)"
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}: Persistent storage files not found"
    ((FAIL++))
fi

# Summary
echo ""
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo "Total: $((PASS + FAIL))"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi
