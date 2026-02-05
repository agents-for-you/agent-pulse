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

# Make the CLI executable
RUN chmod +x index.js

# Create data directory for agent-pulse
RUN mkdir -p /app/.data

# Set environment variables
ENV AGENT_PULSE_EPHEMERAL=false
ENV LOG_LEVEL=INFO

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
