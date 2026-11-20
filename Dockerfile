FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3-venv \
 && python3 -m venv /opt/yt-dlp \
 && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production YTDLP_BIN=/opt/yt-dlp/bin/yt-dlp
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public
COPY src ./src
COPY tools ./tools
RUN mkdir media data && chown node:node media data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
