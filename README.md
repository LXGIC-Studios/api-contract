# @lxgicstudios/api-contract

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/api-contract)](https://www.npmjs.com/package/@lxgicstudios/api-contract)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](https://www.npmjs.com/package/@lxgicstudios/api-contract)

Validate live API responses against a contract schema. Auto-generate contracts from real endpoints, then validate them on every deploy. Catch missing fields, extra fields, type mismatches, and status code changes.

**Zero external dependencies.** Uses only Node.js builtins.

## Install

```bash
npm install -g @lxgicstudios/api-contract
```

Or run directly:

```bash
npx @lxgicstudios/api-contract init https://api.example.com/users
```

## Usage

### Generate a contract

```bash
api-contract init https://api.example.com/users
```

This hits the endpoint and auto-generates a contract schema from the response. The contract is saved in `.api-contracts/`.

### Validate all contracts

```bash
api-contract validate
```

Re-fetches every endpoint and checks the live response against your saved contracts.

### Validate a specific contract

```bash
api-contract validate https://api.example.com/users
```

### Strict mode

```bash
api-contract validate --strict
```

In strict mode, extra fields in the response that aren't in the contract will fail validation. Without it, they're just warnings.

### CI mode

```bash
api-contract validate --strict --ci
```

Minimal output. Just the exit code. Perfect for CI/CD pipelines.

### List contracts

```bash
api-contract list
```

### Show a contract

```bash
api-contract show https://api.example.com/users
```

## Features

- Auto-generate contracts from live API responses
- Deep schema validation with type checking
- Missing field detection (required fields gone from response)
- Extra field detection (new fields not in contract)
- Type mismatch detection (string became number, etc.)
- Status code validation
- Strict mode for zero-tolerance validation
- CI mode with clean exit codes
- Nested object and array validation
- Multiple contract management
- JSON output for automation
- Works with any HTTP method

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help message | |
| `--json` | | Output results as JSON | `false` |
| `--strict` | `-s` | Fail on extra or missing fields | `false` |
| `--ci` | | CI mode: minimal output | `false` |
| `--method <method>` | `-m` | HTTP method | `GET` |
| `--header <key:value>` | `-H` | Add request header (repeatable) | |
| `--body <data>` | `-d` | Request body | |
| `--timeout <ms>` | `-t` | Request timeout | `10000` |
| `--dir <path>` | | Contract directory | `.api-contracts` |

## Commands

| Command | Description |
|---------|-------------|
| `init <url>` | Auto-generate contract from live API |
| `validate [url]` | Validate contracts against live API |
| `list` | List all saved contracts |
| `show <url>` | Display a saved contract |
| `delete <url>` | Remove a saved contract |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All contracts valid |
| `1` | Validation errors found |

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**

[GitHub](https://github.com/lxgicstudios/api-contract) | [Twitter](https://x.com/lxgicstudios)
