// index.js
const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs-extra");
const path = require("path");

async function run() {
    try {
        // --- Input Parameters ---
        // Get the patterns YAML content directly from the user's workflow input
        const patternsYamlContent = core.getInput("patterns_yaml", {
            required: true,
        });
        const dockerImage = core.getInput("docker_image", { required: true });
        const serverUrl = core.getInput("server_url", { required: true });
        const apiKey = core.getInput("api_key", { required: true });

        // Define the standard paths inside the container (fixed)
        const patternsFileInsideContainer = "/tmp/roc-config/pattern.yaml";
        const watchDirInsideContainer = "/tmp/roc-output";
        const libsslContainerPath = "/usr/lib64/libssl.so.3"; // Fixed path inside container
        const libcryptoContainerPath = "/usr/lib64/libcrypto.so.3"; // Fixed path inside container

        // Get configurable host paths for libraries
        const libsslHostPath =
            core.getInput("libssl_host_path", { required: false }) ||
            "/lib/x86_64-linux-gnu/libssl.so.3";
        const libcryptoHostPath =
            core.getInput("libcrypto_host_path", { required: false }) ||
            "/lib/x86_64-linux-gnu/libcrypto.so.3";

        const containerName =
            core.getInput("container_name", { required: false }) ||
            "roc-action-container";
        const outputDirHostPath =
            core.getInput("output_dir_host_path", { required: false }) ||
            "./roc-action-output";
        const extraDockerArgs =
            core.getInput("extra_docker_args", { required: false }) || "";

        const workspace = process.env.GITHUB_WORKSPACE;

        // --- Setup Directories and Config on Host ---
        const hostConfigDir = path.join(workspace, "roc-config-action");
        const hostOutputDir = path.join(
            workspace,
            outputDirHostPath.replace("./", ""),
        ); // Resolve relative path

        await fs.ensureDir(hostConfigDir);
        await fs.ensureDir(hostOutputDir);

        core.info(`Host Config Dir: ${hostConfigDir}`);
        core.info(`Host Output Dir: ${hostOutputDir}`);

        // Write the user-provided YAML content to the host config directory
        // The file name must match what the ROC container expects when you pass --patterns
        const hostPatternFilePath = path.join(hostConfigDir, "pattern.yaml");
        await fs.writeFile(hostPatternFilePath, patternsYamlContent);
        core.info(
            `User-provided patterns file written to: ${hostPatternFilePath}`,
        );

        // --- Run Docker Container ---
        const dockerRunCmd = [
            "docker",
            "run",
            "-d",
            "--name",
            containerName,
            "--privileged",
            "--pid=host",
            "--network=host",
            "-v",
            "/proc:/proc",
            "-v",
            "/sys:/sys",
            "-v",
            `${libsslHostPath}:${libsslContainerPath}`, // Use configurable host path
            "-v",
            `${libcryptoHostPath}:${libcryptoContainerPath}`, // Use configurable host path
            "-v",
            `${hostOutputDir}:/tmp/roc-output`, // Map host output dir to container's /tmp/roc-output
            "-v",
            `${hostConfigDir}:/tmp/roc-config:ro`, // Map host config dir to container's /tmp/roc-config
            ...extraDockerArgs.split(" "), // Add any extra arguments
            dockerImage,
            "--server-url",
            serverUrl,
            "--api-key",
            apiKey,
            "--patterns",
            patternsFileInsideContainer, // Use the standard path inside the container
            "--watch",
            watchDirInsideContainer, // Use the standard path inside the container
        ].filter((arg) => arg !== ""); // Remove empty strings from split

        core.info(`Running Docker command: ${dockerRunCmd.join(" ")}`);
        const dockerRunExitCode = await exec.exec(
            dockerRunCmd[0],
            dockerRunCmd.slice(1),
        );
        if (dockerRunExitCode !== 0) {
            core.setFailed(
                `Docker run failed with exit code ${dockerRunExitCode}`,
            );
            return;
        }

        // Give the container some time to start up before the workflow proceeds
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Sleep for 20 seconds

        // --- Store Container Name for Later Steps (like curl, logs, cleanup) ---
        core.setOutput("container_name", containerName);
        core.info(
            `Container '${containerName}' started and ready for external interaction.`,
        );
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
