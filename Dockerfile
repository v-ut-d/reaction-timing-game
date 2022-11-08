FROM node:18-bullseye AS builder

WORKDIR /app
COPY ./package*.json ./

RUN npm ci

COPY ./tsconfig.json ./prisma/schema.prisma ./
COPY ./src ./src
RUN npm run prisma-setup && npm run build


FROM node:18-bullseye-slim

WORKDIR /app
ENV NODE_ENV production

COPY ./prisma ./prisma
COPY ./package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

CMD ["npm", "start"]
