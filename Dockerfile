# Node 22+ is required. This image is for running the app on a conventional host; the Vercel
# deployment uses api/index.js and vercel.json instead and does not build this.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 TRUST_PROXY=1

# pg is the only runtime dependency.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js notify.js migrate.js content.json ./
# views/ holds the HTML templates and is deliberately outside public/ — see README.
COPY views ./views
COPY public ./public

# The database schema must exist before the app boots: run `npm run migrate` once against it.
# The uploaded media and backups must outlive the container.
VOLUME ["/app/data", "/app/public/media"]
EXPOSE 4174

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4174)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
