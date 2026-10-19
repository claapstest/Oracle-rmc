FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package.json package-lock.json* ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY database/package*.json ./database/

# Install dependencies for all sub-packages
RUN npm install
RUN npm install --prefix backend
RUN npm install --prefix frontend
RUN npm install --prefix database

# Copy entire repository source
COPY . .

# Build both backend (TypeScript) and frontend (Vite React)
RUN npm run build:all

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Start production server
CMD ["node", "index.js"]
