/**
 * Fail if a test database is unreachable.
 *
 * test/driver.test.ts probes each dialect and *skips* the ones it cannot
 * reach, so a misconfigured service costs coverage without failing anything.
 * CI ran that way for a while: the workflow started PostgreSQL and MySQL on
 * ports nothing connected to, and every run reported SQLite only.
 *
 * Host ports come from docker-compose.yml so this cannot drift from what a
 * local `docker compose up -d` provides, which is also what the dialect URLs
 * in the test suite point at.
 */
import {readFileSync} from "node:fs";
import {connect} from "node:net";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

const services = [];
let current = null;
for (const line of compose.split("\n")) {
	const service = line.match(/^ {2}([a-z0-9_-]+):\s*$/i);
	if (service) {
		current = service[1];
		continue;
	}

	const port = line.match(/^\s*-\s*"?(\d+):(\d+)"?\s*$/);
	if (port && current) {
		services.push({name: current, port: Number(port[1])});
		current = null;
	}
}

if (services.length === 0) {
	console.error("No host ports found in docker-compose.yml");
	process.exit(1);
}

const results = await Promise.all(
	services.map(
		({name, port}) =>
			new Promise((resolve) => {
				const socket = connect(port, "127.0.0.1");
				const done = (reachable, detail) => {
					socket.destroy();
					resolve({name, port, reachable, detail});
				};
				socket.setTimeout(10000);
				socket.on("connect", () => done(true));
				socket.on("timeout", () => done(false, "timed out"));
				socket.on("error", (err) => done(false, err.message));
			}),
	),
);

for (const {name, port, reachable, detail} of results) {
	console.log(
		reachable
			? `${name} reachable on ${port}`
			: `${name} UNREACHABLE on ${port}: ${detail}`,
	);
}

if (results.some((result) => !result.reachable)) {
	console.error(
		"\nA dialect the suite expects is unreachable. The tests would skip it " +
			"and still pass, so this is a failure.",
	);
	process.exit(1);
}
