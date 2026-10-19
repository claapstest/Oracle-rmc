FROM node:20-bookworm-slim

WORKDIR /app

# Copy package manifests for layer caching
COPY package.json package-lock.json* ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY database/package*.json ./database/

# Install dependencies cleanly for each service (no recursion)
RUN npm --prefix backend install --no-audit --no-fund
RUN npm --prefix frontend install --no-audit --no-fund
RUN npm --prefix database install --no-audit --no-fund

# Copy remaining source code
COPY . .

# Build backend (tsc) and frontend (vite)
RUN npm run build:backend
RUN npm run build:frontend

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Start production server
CMD ["node", "index.js"]
