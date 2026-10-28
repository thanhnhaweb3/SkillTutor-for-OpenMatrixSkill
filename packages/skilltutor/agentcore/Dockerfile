# Amazon Bedrock AgentCore Runtime requires linux/arm64.
# Build from the repository root:
#   docker buildx build --platform linux/arm64 -f packages/skilltutor/agentcore/Dockerfile -t skilltutor-agent .
FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev
COPY packages ./packages
EXPOSE 8080
CMD ["npx", "tsx", "packages/skilltutor/agentcore/server.ts"]
