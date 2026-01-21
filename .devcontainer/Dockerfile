# syntax=docker/dockerfile:1

FROM node:18

# Install git and other essentials
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspaces/excalidraw

# Create node_modules directory and set permissions
RUN mkdir -p /workspaces/excalidraw/node_modules && \
    chown -R node:node /workspaces/excalidraw

# Switch to node user
USER node
