FROM node:18-bullseye AS builder

WORKDIR /app
COPY package*.json ./

RUN npm ci
RUN npm run prisma-setup

COPY . .
RUN npm run build

FROM node:18-bullseye-slim AS runner

WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

CMD ["npm", "start"]
