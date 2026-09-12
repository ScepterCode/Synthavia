# Node 22+ is required: the app uses the built-in node:sqlite module.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174 TRUST_PROXY=1

# No dependencies to install — package.json is copied for metadata and scripts only.
COPY package.json ./
COPY server.js db.js notify.js content.json ./
COPY public ./public

# The database and uploaded media must outlive the container.
VOLUME ["/app/data", "/app/public/media"]
EXPOSE 4174

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4174)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
