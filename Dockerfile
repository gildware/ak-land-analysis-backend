FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy Prisma schema BEFORE generate
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy remaining source code
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 👇 RUN MIGRATIONS THEN START SERVER
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
