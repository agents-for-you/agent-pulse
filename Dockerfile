FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Make the CLI and entrypoint executable
RUN chmod +x index.js docker-entrypoint.sh

# Create data directory for agent-pulse with proper permissions
RUN mkdir -p /app/.data && \
    chown -R node:node /app/.data

# Switch to non-root user
USER node

# Set environment variables
ENV AGENT_PULSE_EPHEMERAL=false \
    LOG_LEVEL=INFO \
    NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD sh -c "test -f /app/.data/server.pid && cat /app/.data/server.pid | xargs kill -0 2>/dev/null || exit 1"

# Use dumb-init to handle signals properly, with entrypoint script
ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "index.js"]
