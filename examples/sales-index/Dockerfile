# One image, every target — Railway, Render, Fly, and plain `docker run` all
# take this unchanged. Only the platform config around it differs.
FROM oven/bun:1-alpine

WORKDIR /app

# Deps first so a code edit doesn't reinstall them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

# The health server binds $PORT; platforms that inject their own override this.
ENV PORT=8080
EXPOSE 8080

# Not `bun --watch`, and no shell wrapper: bun receives SIGTERM directly as
# PID 1, which is what makes the graceful shutdown in indexer.ts actually run.
CMD ["bun", "run", "indexer.ts"]
