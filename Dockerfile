FROM node:20-bookworm-slim

WORKDIR /app

# Copy package manifests for layer caching
COPY package.json package-lock.json* ./
COPY backend/package*.json ./backend/
COPY database/package*.json ./database/

# Install dependencies cleanly for backend and database services
RUN npm --prefix backend install --no-audit --no-fund
RUN npm --prefix database install --no-audit --no-fund

# Copy remaining source code
COPY . .

# Build backend (tsc)
RUN npm run build:backend

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Start production server with automated DB migrations & seed
CMD ["npm", "run", "start:migrate"]
