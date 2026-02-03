/**
 * Docker availability helpers
 */

export class DockerNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerNotAvailableError";
  }
}

/**
 * Check if Docker is available and running
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await Bun.$`docker info`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Require Docker to be available, throw helpful error if not
 */
export async function requireDocker(): Promise<void> {
  // First check if docker command exists
  const whichResult = await Bun.$`which docker`.quiet().nothrow();
  if (whichResult.exitCode !== 0) {
    throw new DockerNotAvailableError(
      "Docker is not installed.\n\n" +
      "Install Docker:\n" +
      "  macOS:  brew install --cask docker\n" +
      "          or download from https://docker.com/products/docker-desktop\n" +
      "  Linux:  curl -fsSL https://get.docker.com | sh\n"
    );
  }

  // Check if Docker daemon is running
  const available = await isDockerAvailable();
  if (!available) {
    throw new DockerNotAvailableError(
      "Docker daemon is not running.\n\n" +
      "Start Docker:\n" +
      "  macOS:  Open Docker Desktop or OrbStack\n" +
      "  Linux:  sudo systemctl start docker\n"
    );
  }
}

/**
 * Check if a container is running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
  const result = await Bun.$`docker ps -q -f name=${name}`.quiet().nothrow();
  return result.stdout.toString().trim().length > 0;
}

/**
 * Check if a container exists (running or stopped)
 */
export async function containerExists(name: string): Promise<boolean> {
  const result = await Bun.$`docker ps -aq -f name=${name}`.quiet().nothrow();
  return result.stdout.toString().trim().length > 0;
}

/**
 * Stop and remove a container
 */
export async function removeContainer(name: string): Promise<void> {
  await Bun.$`docker stop ${name}`.quiet().nothrow();
  await Bun.$`docker rm ${name}`.quiet().nothrow();
}
