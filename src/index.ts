#!/usr/bin/env node

import https from "node:https";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { createHash } from "node:crypto";

// ── ANSI Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const CONTRACT_DIR = ".api-contracts";

function printBanner(): void {
  console.log(`
${c.cyan}${c.bold}  ╔══════════════════════════════════╗
  ║        📋 api-contract            ║
  ║   API Contract Validator          ║
  ╚══════════════════════════════════╝${c.reset}
`);
}

function printHelp(): void {
  printBanner();
  console.log(`${c.bold}USAGE${c.reset}
  ${c.cyan}api-contract init${c.reset} <url>           Auto-generate contract from live API
  ${c.cyan}api-contract validate${c.reset}             Validate all contracts against live API
  ${c.cyan}api-contract validate${c.reset} <url>       Validate a single contract
  ${c.cyan}api-contract list${c.reset}                 List all saved contracts
  ${c.cyan}api-contract show${c.reset} <url>           Show a contract
  ${c.cyan}api-contract delete${c.reset} <url>         Delete a contract

${c.bold}OPTIONS${c.reset}
  ${c.green}--help${c.reset}                Show this help message
  ${c.green}--json${c.reset}                Output results as JSON
  ${c.green}--strict${c.reset}              Fail on extra or missing fields
  ${c.green}--ci${c.reset}                  CI mode: minimal output, exit code only
  ${c.green}--method <method>${c.reset}     HTTP method (default: GET)
  ${c.green}--header <key:value>${c.reset}  Add request header (repeatable)
  ${c.green}--body <data>${c.reset}         Request body
  ${c.green}--timeout <ms>${c.reset}        Request timeout (default: 10000)
  ${c.green}--dir <path>${c.reset}          Contract directory (default: .api-contracts)

${c.bold}EXAMPLES${c.reset}
  ${c.dim}$ api-contract init https://api.example.com/users${c.reset}
  ${c.dim}$ api-contract validate${c.reset}
  ${c.dim}$ api-contract validate --strict --ci${c.reset}
  ${c.dim}$ api-contract init https://api.example.com/data --method POST --body '{"q":"test"}'${c.reset}
`);
}

interface ParsedArgs {
  command: string;
  url: string | null;
  json: boolean;
  strict: boolean;
  ci: boolean;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeout: number;
  dir: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    url: null,
    json: false,
    strict: false,
    ci: false,
    method: "GET",
    headers: {},
    body: null,
    timeout: 10000,
    dir: CONTRACT_DIR,
    help: false,
  };

  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--strict":
      case "-s":
        result.strict = true;
        break;
      case "--ci":
        result.ci = true;
        break;
      case "--method":
      case "-m":
        result.method = (argv[++i] || "GET").toUpperCase();
        break;
      case "--header":
      case "-H": {
        const hdr = argv[++i] || "";
        const idx = hdr.indexOf(":");
        if (idx > 0) {
          result.headers[hdr.slice(0, idx).trim()] = hdr.slice(idx + 1).trim();
        }
        break;
      }
      case "--body":
      case "-d":
        result.body = argv[++i] || null;
        break;
      case "--timeout":
      case "-t":
        result.timeout = parseInt(argv[++i], 10) || 10000;
        break;
      case "--dir":
        result.dir = argv[++i] || CONTRACT_DIR;
        break;
      default:
        if (!arg.startsWith("-")) {
          if (positional === 0) result.command = arg;
          else if (positional === 1) result.url = arg;
          positional++;
        }
        break;
    }
  }

  return result;
}

// ── Schema Types ──
type SchemaType = "string" | "number" | "boolean" | "null" | "object" | "array";

interface FieldSchema {
  type: SchemaType | SchemaType[];
  required: boolean;
  fields?: Record<string, FieldSchema>;
  items?: FieldSchema;
  example?: any;
}

interface Contract {
  url: string;
  method: string;
  status: number;
  schema: Record<string, FieldSchema>;
  timestamp: string;
}

// ── HTTP Request ──
async function fetchUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeout: number
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;

    const req = client.request(
      url,
      {
        method,
        headers: { "User-Agent": "api-contract/1.0.0", ...headers },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ── Schema Generation ──
function getType(value: any): SchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as SchemaType;
}

function generateSchema(value: any): FieldSchema {
  const type = getType(value);

  if (type === "object" && value !== null) {
    const fields: Record<string, FieldSchema> = {};
    for (const [key, val] of Object.entries(value)) {
      fields[key] = generateSchema(val);
    }
    return { type: "object", required: true, fields };
  }

  if (type === "array" && Array.isArray(value)) {
    let items: FieldSchema | undefined;
    if (value.length > 0) {
      items = generateSchema(value[0]);
    }
    return { type: "array", required: true, items };
  }

  return { type, required: true, example: value };
}

// ── Contract Storage ──
function contractFilename(url: string, method: string): string {
  const hash = createHash("md5").update(`${method}:${url}`).digest("hex").slice(0, 12);
  const parsed = new URL(url);
  const safeName = parsed.hostname.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeName}_${hash}.json`;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function saveContract(dir: string, contract: Contract): string {
  ensureDir(dir);
  const filename = contractFilename(contract.url, contract.method);
  const filepath = path.join(dir, filename);
  writeFileSync(filepath, JSON.stringify(contract, null, 2));
  return filepath;
}

function loadContract(dir: string, url: string, method: string): Contract | null {
  const filename = contractFilename(url, method);
  const filepath = path.join(dir, filename);
  if (!existsSync(filepath)) return null;
  return JSON.parse(readFileSync(filepath, "utf-8"));
}

function loadAllContracts(dir: string): Contract[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf-8")));
}

// ── Validation ──
interface ValidationIssue {
  path: string;
  type: "missing_field" | "extra_field" | "type_mismatch" | "status_mismatch";
  expected?: string;
  actual?: string;
  severity: "error" | "warning";
}

function validateValue(
  value: any,
  schema: FieldSchema,
  pathPrefix: string,
  strict: boolean
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const actualType = getType(value);

  // Type check
  const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!expectedTypes.includes(actualType)) {
    issues.push({
      path: pathPrefix,
      type: "type_mismatch",
      expected: expectedTypes.join(" | "),
      actual: actualType,
      severity: "error",
    });
    return issues;
  }

  // Object field checks
  if (actualType === "object" && schema.fields) {
    const actualKeys = new Set(Object.keys(value));
    const schemaKeys = new Set(Object.keys(schema.fields));

    // Missing fields
    for (const key of schemaKeys) {
      if (!actualKeys.has(key) && schema.fields[key].required) {
        issues.push({
          path: `${pathPrefix}.${key}`,
          type: "missing_field",
          severity: "error",
        });
      }
    }

    // Extra fields
    for (const key of actualKeys) {
      if (!schemaKeys.has(key)) {
        issues.push({
          path: `${pathPrefix}.${key}`,
          type: "extra_field",
          severity: strict ? "error" : "warning",
        });
      }
    }

    // Recurse into matching fields
    for (const key of actualKeys) {
      if (schemaKeys.has(key)) {
        issues.push(
          ...validateValue(value[key], schema.fields[key], `${pathPrefix}.${key}`, strict)
        );
      }
    }
  }

  // Array item checks
  if (actualType === "array" && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      issues.push(
        ...validateValue(value[i], schema.items, `${pathPrefix}[${i}]`, strict)
      );
    }
  }

  return issues;
}

function printIssues(issues: ValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (errors.length > 0) {
    console.log(`  ${c.red}${c.bold}Errors (${errors.length})${c.reset}`);
    for (const issue of errors) {
      const desc = issueDescription(issue);
      console.log(`    ${c.red}✗${c.reset} ${issue.path}: ${desc}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Warnings (${warnings.length})${c.reset}`);
    for (const issue of warnings) {
      const desc = issueDescription(issue);
      console.log(`    ${c.yellow}!${c.reset} ${issue.path}: ${desc}`);
    }
  }
}

function issueDescription(issue: ValidationIssue): string {
  switch (issue.type) {
    case "missing_field":
      return "Field is missing from response";
    case "extra_field":
      return "Field wasn't in the contract";
    case "type_mismatch":
      return `Expected ${issue.expected}, got ${issue.actual}`;
    case "status_mismatch":
      return `Expected status ${issue.expected}, got ${issue.actual}`;
    default:
      return issue.type;
  }
}

// ── Commands ──
async function cmdInit(args: ParsedArgs): Promise<void> {
  if (!args.url) {
    console.error(`${c.red}Error: URL required. Usage: api-contract init <url>${c.reset}`);
    process.exit(1);
  }

  if (!args.ci && !args.json) console.log(`  ${c.cyan}Fetching${c.reset} ${args.url}...\n`);

  const response = await fetchUrl(args.url, args.method, args.headers, args.body, args.timeout);

  if (typeof response.body !== "object" || response.body === null) {
    console.error(`${c.red}Error: Response isn't a JSON object. Can't generate a contract from non-JSON responses.${c.reset}`);
    process.exit(1);
  }

  const schema: Record<string, FieldSchema> = {};
  for (const [key, val] of Object.entries(response.body)) {
    schema[key] = generateSchema(val);
  }

  const contract: Contract = {
    url: args.url,
    method: args.method,
    status: response.status,
    schema,
    timestamp: new Date().toISOString(),
  };

  const filepath = saveContract(args.dir, contract);

  if (args.json) {
    console.log(JSON.stringify({ created: true, path: filepath, contract }, null, 2));
  } else if (!args.ci) {
    console.log(`  ${c.green}✓ Contract generated${c.reset}`);
    console.log(`    URL: ${contract.url}`);
    console.log(`    Method: ${contract.method}`);
    console.log(`    Expected status: ${contract.status}`);
    console.log(`    Fields: ${Object.keys(schema).length}`);
    console.log(`    File: ${c.dim}${filepath}${c.reset}\n`);
    console.log(`  ${c.dim}Run 'api-contract validate' to check against this contract.${c.reset}\n`);
  }
}

async function cmdValidate(args: ParsedArgs): Promise<void> {
  let contracts: Contract[];

  if (args.url) {
    const contract = loadContract(args.dir, args.url, args.method);
    if (!contract) {
      console.error(`${c.red}Error: No contract found for ${args.url}. Run 'api-contract init ${args.url}' first.${c.reset}`);
      process.exit(1);
    }
    contracts = [contract];
  } else {
    contracts = loadAllContracts(args.dir);
    if (contracts.length === 0) {
      console.error(`${c.red}Error: No contracts found. Run 'api-contract init <url>' to create one.${c.reset}`);
      process.exit(1);
    }
  }

  if (!args.ci && !args.json) {
    console.log(`  ${c.cyan}Validating ${contracts.length} contract(s)...${c.reset}\n`);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const allResults: any[] = [];

  for (const contract of contracts) {
    try {
      const response = await fetchUrl(
        contract.url,
        contract.method,
        args.headers,
        args.body,
        args.timeout
      );

      const issues: ValidationIssue[] = [];

      // Status check
      if (response.status !== contract.status) {
        issues.push({
          path: "status",
          type: "status_mismatch",
          expected: String(contract.status),
          actual: String(response.status),
          severity: "error",
        });
      }

      // Schema validation
      if (typeof response.body === "object" && response.body !== null) {
        for (const [key, fieldSchema] of Object.entries(contract.schema)) {
          if (!(key in response.body)) {
            if (fieldSchema.required) {
              issues.push({
                path: key,
                type: "missing_field",
                severity: "error",
              });
            }
          } else {
            issues.push(
              ...validateValue(response.body[key], fieldSchema, key, args.strict)
            );
          }
        }

        // Check for extra top-level fields
        for (const key of Object.keys(response.body)) {
          if (!(key in contract.schema)) {
            issues.push({
              path: key,
              type: "extra_field",
              severity: args.strict ? "error" : "warning",
            });
          }
        }
      }

      const errors = issues.filter((i) => i.severity === "error");
      const warnings = issues.filter((i) => i.severity === "warning");
      totalErrors += errors.length;
      totalWarnings += warnings.length;

      const passed = errors.length === 0;

      if (args.json) {
        allResults.push({
          url: contract.url,
          method: contract.method,
          passed,
          errors: errors.length,
          warnings: warnings.length,
          issues,
        });
      } else if (!args.ci) {
        const icon = passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
        console.log(`  ${icon} ${c.bold}${contract.method} ${contract.url}${c.reset}`);

        if (issues.length > 0) {
          printIssues(issues);
        } else {
          console.log(`    ${c.green}All checks passed${c.reset}`);
        }
        console.log();
      }
    } catch (err: any) {
      totalErrors++;
      if (args.json) {
        allResults.push({
          url: contract.url,
          method: contract.method,
          passed: false,
          error: err.message,
        });
      } else if (!args.ci) {
        console.log(`  ${c.red}✗ ${contract.method} ${contract.url}${c.reset}`);
        console.log(`    ${c.red}Error: ${err.message}${c.reset}\n`);
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      total: contracts.length,
      passed: contracts.length - allResults.filter((r) => !r.passed).length,
      failed: allResults.filter((r) => !r.passed).length,
      errors: totalErrors,
      warnings: totalWarnings,
      results: allResults,
    }, null, 2));
  } else if (!args.ci) {
    console.log(`${c.bold}${c.cyan}─── Summary ───${c.reset}`);
    console.log(
      `  Contracts: ${contracts.length}  |  ${c.green}Errors: ${totalErrors}${c.reset}  |  ${c.yellow}Warnings: ${totalWarnings}${c.reset}`
    );
    if (totalErrors === 0) {
      console.log(`\n  ${c.green}${c.bold}All contracts valid!${c.reset}\n`);
    } else {
      console.log(`\n  ${c.red}${c.bold}Validation failed.${c.reset}\n`);
    }
  }

  if (totalErrors > 0) process.exit(1);
}

function cmdList(args: ParsedArgs): void {
  const contracts = loadAllContracts(args.dir);

  if (contracts.length === 0) {
    if (!args.ci) console.log(`  ${c.dim}No contracts found. Run 'api-contract init <url>' to create one.${c.reset}\n`);
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(contracts.map((ct) => ({
      url: ct.url,
      method: ct.method,
      status: ct.status,
      fields: Object.keys(ct.schema).length,
      timestamp: ct.timestamp,
    })), null, 2));
  } else {
    console.log(`  ${c.bold}Contracts (${contracts.length})${c.reset}\n`);
    for (const ct of contracts) {
      console.log(`    ${c.cyan}${ct.method}${c.reset} ${ct.url}`);
      console.log(`      Status: ${ct.status}  |  Fields: ${Object.keys(ct.schema).length}  |  ${c.dim}${ct.timestamp}${c.reset}`);
    }
    console.log();
  }
}

function cmdShow(args: ParsedArgs): void {
  if (!args.url) {
    console.error(`${c.red}Error: URL required. Usage: api-contract show <url>${c.reset}`);
    process.exit(1);
  }

  const contract = loadContract(args.dir, args.url, args.method);
  if (!contract) {
    console.error(`${c.red}Error: No contract found for ${args.url}.${c.reset}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(contract, null, 2));
  } else {
    console.log(`  ${c.bold}Contract: ${contract.method} ${contract.url}${c.reset}`);
    console.log(`  Expected status: ${contract.status}`);
    console.log(`  Generated: ${contract.timestamp}\n`);
    console.log(`  ${c.bold}Schema:${c.reset}`);
    printSchema(contract.schema, "    ");
    console.log();
  }
}

function printSchema(schema: Record<string, FieldSchema>, indent: string): void {
  for (const [key, field] of Object.entries(schema)) {
    const typeStr = Array.isArray(field.type) ? field.type.join(" | ") : field.type;
    const reqStr = field.required ? "" : ` ${c.dim}(optional)${c.reset}`;
    console.log(`${indent}${c.cyan}${key}${c.reset}: ${c.yellow}${typeStr}${c.reset}${reqStr}`);

    if (field.fields) {
      printSchema(field.fields, indent + "  ");
    }
    if (field.items) {
      const itemType = Array.isArray(field.items.type) ? field.items.type.join(" | ") : field.items.type;
      console.log(`${indent}  ${c.dim}items: ${itemType}${c.reset}`);
      if (field.items.fields) {
        printSchema(field.items.fields, indent + "    ");
      }
    }
  }
}

function cmdDelete(args: ParsedArgs): void {
  if (!args.url) {
    console.error(`${c.red}Error: URL required. Usage: api-contract delete <url>${c.reset}`);
    process.exit(1);
  }

  const filename = contractFilename(args.url, args.method);
  const filepath = path.join(args.dir, filename);

  if (!existsSync(filepath)) {
    console.error(`${c.red}Error: No contract found for ${args.url}.${c.reset}`);
    process.exit(1);
  }

  unlinkSync(filepath);

  if (args.json) {
    console.log(JSON.stringify({ deleted: true, url: args.url }));
  } else {
    console.log(`  ${c.green}✓ Contract deleted for ${args.url}${c.reset}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.command) {
    printHelp();
    process.exit(1);
  }

  if (!args.json && !args.ci) printBanner();

  switch (args.command) {
    case "init":
      await cmdInit(args);
      break;
    case "validate":
      await cmdValidate(args);
      break;
    case "list":
      cmdList(args);
      break;
    case "show":
      cmdShow(args);
      break;
    case "delete":
      cmdDelete(args);
      break;
    default:
      console.error(`${c.red}Unknown command: ${args.command}. Use --help for usage.${c.reset}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
