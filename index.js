// index.js
const core = require("@actions/core");
const exec = require("@actions/exec");
const fs = require("fs-extra");
const path = require("path");
// const yaml = require('js-yaml'); // Removed: Not needed if we don't generate defaults

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
        // Define the standard paths inside the container
        const patternsFileInsideContainer = "/tmp/roc-config/pattern.yaml";
        const watchDirInsideContainer = "/tmp/roc-output";
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
            "/lib/x86_64-linux-gnu/libssl.so.3:/usr/lib64/libssl.so.3",
            "-v",
            "/lib/x86_64-linux-gnu/libcrypto.so.3:/usr/lib64/libcrypto.so.3",
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

        // Give the container some time to start up
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Sleep for 20 seconds

        // --- Simulate Traffic (Optional Step within Action) ---
        core.info("Simulating network traffic...");
        const simulateCmd = [
            "docker",
            "exec",
            containerName,
            "sh",
            "-c",
            'find / -name "libssl.so*" 2>/dev/null; ldd $(which curl); echo "Generating curl traffic..."; curl -s https://example.com > /dev/null || true; curl -s -X POST "https://httpbin.org/post?test=12345667788764" -H "Content-Type: application/json" -d \'{"data":"12345667788764"}\' > /dev/null || true',
        ];
        await exec.exec(simulateCmd[0], simulateCmd.slice(1));
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait after traffic

        // --- Print Container Logs ---
        core.info("Fetching ROC container logs...");
        await exec.exec("docker", ["logs", containerName]);

        // --- More Simulated Traffic ---
        core.info("Simulating more network traffic...");
        const moreTrafficCmd = [
            "docker",
            "exec",
            containerName,
            "sh",
            "-c",
            'curl -X POST "https://example.com?more=12345667788764" -H "Content-Type: application/json" -d \'{"info":"12345667788764"}\' > /dev/null || true',
        ];
        await exec.exec(moreTrafficCmd[0], moreTrafficCmd.slice(1));
        await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait after traffic

        // --- Print Container Logs Again ---
        core.info("Fetching ROC container logs again...");
        await exec.exec("docker", ["logs", containerName]);

        // --- Print Output Files (if any) ---
        core.info("Checking for output files in host output directory...");
        const outputFiles = await fs.readdir(hostOutputDir);
        if (outputFiles.length > 0) {
            for (const file of outputFiles) {
                const filePath = path.join(hostOutputDir, file);
                core.info(`Contents of ${filePath}:`);
                const content = await fs.readFile(filePath, "utf8");
                console.log(content); // Use console.log for raw output
            }
        } else {
            core.info("No output files found in the host output directory.");
        }

        // --- Store Container Name for Later Cleanup (if needed) ---
        core.setOutput("container_name", containerName);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
