# Docs: docs/04 - Architecture/Server.md
# Purpose: the Dholphin server's image: the server and the built web app, run as an unprivileged user, data in /data.
# Built by tools/build_server.sh from the repository root, after the web app is built (web/dist).
# Docs: Docker/Dockerfile reference.
FROM node:24-alpine
ENV NODE_ENV=production PORT=8080 DATA=/data DIST=/app/web/dist
WORKDIR /app
COPY VERSION ./VERSION
COPY server ./server
COPY web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/main.mjs"]
