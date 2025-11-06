const core = require("@actions/core");
const exec = require("@actions/exec");
const io = require("@actions/io");
const fs = require("fs-extra");
const path = require("path");

async function run() {
  try {
    // Get inputs
    const serverUrl = core.getInput("server-url", { required: true });
    const apiKey = core.getInput("api-key", { required: true });
    const patterns = core.getInput("patterns", { required: true });
    const configDir = core.getInput("config-dir") || "roc-config";
    const outputDir = core.getInput("output-dir") || "roc-output";
    const dockerImage = core.getInput("docker-image") || "hanshal785/roc:v5";
    const additionalArgs = core.getInput("additional-args") || "";
    const sslLibPath = core.getInput("ssl-lib-path") || "/lib/x86_64-linux-gnu";
    const sslLibVersion = core.getInput("ssl-lib-version") || "3";

    core.info("ROC GitHub Action started");
    core.info(`Server URL: ${serverUrl}`);
    core.info(`Config directory: ${configDir}`);
    core.info(`Pattern file: ${patterns}`);
    core.info(`Output directory: ${outputDir}`);

    // Validate pattern file exists
    const patternFilePath = path.join(
      process.env.GITHUB_WORKSPACE || ".",
      configDir,
      patterns,
    );
    if (!fs.existsSync(patternFilePath)) {
      throw new Error(`Pattern file does not exist: ${patternFilePath}`);
    }

    core.info(`Pattern file found: ${patternFilePath}`);
    const patternContent = fs.readFileSync(patternFilePath, "utf8");
    core.info(
      `Pattern file content preview: ${patternContent.substring(0, 200)}...`,
    );

    // Check SSL libraries exist
    const sslLibExists = await checkSslLibraries(sslLibPath, sslLibVersion);
    if (!sslLibExists) {
      core.warning(
        `SSL libraries not found at ${sslLibPath}. ROC may fail to start.`,
      );
    } else {
      core.info(`SSL libraries found at: ${sslLibPath}`);
    }

    // Create directories
    await fs.ensureDir(outputDir);
    await fs.ensureDir(configDir);

    // Build SSL arguments
    let sslArgs = [];
    if (sslLibExists) {
      sslArgs = [
        `-v`,
        `${sslLibPath}/libssl.so.${sslLibVersion}:/usr/lib64/libssl.so.${sslLibVersion}`,
        `-v`,
        `${sslLibPath}/libcrypto.so.${sslLibVersion}:/usr/lib64/libcrypto.so.${sslLibVersion}`,
      ];
    }

    // Build docker command
    const dockerArgs = [
      "run",
      "-d",
      "--name",
      "roc-test",
      "--privileged",
      "--pid=host",
      "--network=host",
      "-v",
      "/proc:/proc",
      "-v",
      "/sys:/sys",
      ...sslArgs,
      "-v",
      `${process.env.GITHUB_WORKSPACE || "."}/${outputDir}:/tmp/roc-output`,
      "-v",
      `${process.env.GITHUB_WORKSPACE || "."}/${configDir}:/tmp/roc-config:ro`,
      dockerImage,
      "--server-url",
      serverUrl,
      "--api-key",
      apiKey,
      "--patterns",
      `/tmp/roc-config/${patterns}`,
      "--watch",
      "/tmp/roc-output",
    ];

    // Add additional arguments if provided
    if (additionalArgs.trim()) {
      dockerArgs.push(...additionalArgs.trim().split(" "));
    }

    core.info("Starting ROC container...");
    core.info(`Docker command: docker ${dockerArgs.join(" ")}`);

    // Run the container
    const exitCode = await exec.exec("docker", dockerArgs);

    if (exitCode !== 0) {
      throw new Error(`Failed to start ROC container. Exit code: ${exitCode}`);
    }

    // Get container ID
    let containerId = "";
    await exec.exec("docker", ["ps", "-q", "--filter", "name=roc-test"], {
      listeners: {
        stdout: (data) => {
          containerId += data.toString();
        },
      },
    });

    containerId = containerId.trim();
    core.setOutput("container-id", containerId);
    core.info(`ROC container started with ID: ${containerId}`);

    // Monitor container status
    await monitorContainer(containerId);

    // Get output files
    const outputFiles = await getOutputFiles(outputDir);
    core.setOutput("output-files", outputFiles);
    core.info(`Output files: ${outputFiles}`);

    // Get logs
    const logs = await getContainerLogs(containerId);
    core.setOutput("logs", logs);
    core.info("ROC container logs captured");
  } catch (error) {
    core.setFailed(error.message);
    core.error(error.stack);
  } finally {
    // Always cleanup
    await cleanupContainer();
  }
}

async function checkSslLibraries(sslLibPath, sslLibVersion) {
  try {
    const sslPath = path.join(sslLibPath, `libssl.so.${sslLibVersion}`);
    const cryptoPath = path.join(sslLibPath, `libcrypto.so.${sslLibVersion}`);

    const sslExists = await fs.pathExists(sslPath);
    const cryptoExists = await fs.pathExists(cryptoPath);

    if (sslExists && cryptoExists) {
      core.info(`Found SSL libraries: ${sslPath}, ${cryptoPath}`);
      return true;
    }

    core.warning(`SSL libraries not found: ${sslPath}, ${cryptoPath}`);
    return false;
  } catch (error) {
    core.warning(`Error checking SSL libraries: ${error.message}`);
    return false;
  }
}

async function monitorContainer(containerId) {
  core.info("Monitoring ROC container...");

  // Check container status periodically
  for (let i = 0; i < 30; i++) {
    // Check for 5 minutes (30 * 10 seconds)
    let status = "";
    try {
      await exec.exec(
        "docker",
        ["inspect", "--format", "{{.State.Status}}", containerId],
        {
          listeners: {
            stdout: (data) => {
              status += data.toString().trim();
            },
          },
        },
      );

      if (status === "running") {
        core.info("ROC container is running");
        break;
      } else if (status === "exited") {
        core.warning("ROC container has exited");
        break;
      }

      core.info(`Container status: ${status}, waiting...`);
      await sleep(10000); // Wait 10 seconds
    } catch (error) {
      core.warning(`Could not inspect container: ${error.message}`);
      break;
    }
  }

  // Show current logs
  await exec.exec("docker", ["logs", containerId]);
}

async function getOutputFiles(outputDir) {
  try {
    const files = await fs.readdir(outputDir);
    return files.join("\n");
  } catch (error) {
    core.warning(`Could not read output directory: ${error.message}`);
    return "";
  }
}

async function getContainerLogs(containerId) {
  try {
    let logs = "";
    await exec.exec("docker", ["logs", containerId], {
      listeners: {
        stdout: (data) => {
          logs += data.toString();
        },
        stderr: (data) => {
          logs += data.toString();
        },
      },
    });
    return logs;
  } catch (error) {
    core.warning(`Could not get container logs: ${error.message}`);
    return "";
  }
}

async function cleanupContainer() {
  try {
    core.info("Cleaning up ROC container...");

    // Stop container
    await exec.exec("docker", ["stop", "roc-test"], {
      ignoreReturnCode: true,
    });

    // Remove container
    await exec.exec("docker", ["rm", "roc-test"], {
      ignoreReturnCode: true,
    });

    core.info("Container cleanup completed");
  } catch (error) {
    core.warning(`Cleanup error: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the action
run();
