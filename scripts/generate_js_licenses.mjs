#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { project: null, output: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--output") {
      args.output = argv[++i];
    }
  }
  if (!args.project) {
    throw new Error("Missing --project <dir>");
  }
  if (!args.output) {
    args.output = "licenses/frontend_licenses.json";
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}


function cleanLicense(license) {
  if (!license) return "Unknown";
  if (typeof license === "string") return license;
  if (typeof license === "object" && "type" in license) return license.type;
  return JSON.stringify(license);
}

async function main() {
  const { project, output } = parseArgs(process.argv);
  const projectRoot = path.resolve(process.cwd(), project);
  const lockPath = path.join(projectRoot, "package-lock.json");
  const lock = await readJson(lockPath);
  const packages = lock.packages || {};

  const results = [];
  for (const [pkgPath, info] of Object.entries(packages)) {
    // We only care about actual dependencies listed under node_modules
    if (!pkgPath || !pkgPath.startsWith("node_modules")) continue;

    // Derive package name from the path segment after the last `node_modules/`
    const parts = pkgPath.split("/");
    let name = null;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i] === "node_modules") {
        const next = parts[i + 1];
        if (!next) break;
        if (next.startsWith("@")) {
          const scoped = parts[i + 2];
          if (scoped) name = `${next}/${scoped}`;
        } else {
          name = next;
        }
        break;
      }
    }
    if (!name) continue;

    const entry = {
      name,
      version: info.version || "0.0.0",
      // Prefer license from lockfile when present; otherwise mark Unknown
      license: cleanLicense(info.license),
      // Use resolved tarball URL as a best-effort reference if available
      repository: info.resolved || "",
    };
    results.push(entry);
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  const outputPath = path.resolve(process.cwd(), output);
  await writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${results.length} license entries to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
