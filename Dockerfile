FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --ignore-scripts

COPY server ./server
COPY content ./content
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run server:build

FROM build AS migration

ENV QUESTION_CONTENT_DIR=/app/content
USER node
CMD ["npm", "run", "db:deploy", "--workspace", "server"]

FROM node:24-alpine AS production-deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --omit=peer --ignore-scripts

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    QUESTION_CONTENT_DIR=/app/content

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/prisma.config.ts ./server/prisma.config.ts
COPY --from=build /app/content ./content

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/src/server.js"]
