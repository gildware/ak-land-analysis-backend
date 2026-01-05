# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files first for caching
COPY package*.json tsconfig*.json ./

# Install all dependencies (dev + prod) for build and seeding
RUN npm install

# Copy all source code
COPY . .

# Build TypeScript -> JavaScript
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy built JS files
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/config ./src/config
COPY --from=build /app/tsconfig*.json ./

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start app
CMD ["node", "dist/index.js"]
