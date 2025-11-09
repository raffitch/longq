#!/usr/bin/env node
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const LICENSE_REGEX = /^(license|licence|copying)(\.[^.]+)?$/i;

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

async function findLicenseText(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!LICENSE_REGEX.test(entry.name)) continue;
    try {
      const text = (await readFile(path.join(dir, entry.name), "utf8")).trim();
      if (text) {
        return text;
      }
    } catch {
      // ignore
    }
  }
  return null;
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
  const nodeModules = path.join(projectRoot, "node_modules");
  const lock = await readJson(lockPath);
  const packages = lock.packages || {};

  const results = [];
  for (const [pkgPath, info] of Object.entries(packages)) {
    const rel = pkgPath || "";
    if (!rel.startsWith("node_modules")) {
      continue;
    }
    const segments = rel.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const pkgRoot = path.join(projectRoot, ...segments);
    let pkgJson;
    try {
      pkgJson = await readJson(path.join(pkgRoot, "package.json"));
    } catch {
      continue;
    }
    const repo =
      (pkgJson.repository && (pkgJson.repository.url || pkgJson.repository)) ||
      pkgJson.homepage ||
      "";
    const entry = {
      name: pkgJson.name || segments.at(-1),
      version: pkgJson.version || info.version || "0.0.0",
      license: cleanLicense(pkgJson.license || pkgJson.licenses),
      repository: repo,
    };
    const text = await findLicenseText(pkgRoot);
    if (text) {
      entry.licenseText = text;
    }
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
