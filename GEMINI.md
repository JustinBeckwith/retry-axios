# Project: retry-axios

## Project Overview

`retry-axios` is a TypeScript library that provides automatic retries for `axios` requests. It uses Axios interceptors to catch failed requests and retry them with configurable backoff strategies. The library is highly flexible, allowing users to customize retry conditions, backoff types (exponential, static, linear), and jitter to prevent the "thundering herd" problem. It is designed to be used with any version of `axios` as a peer dependency.

The project is written in TypeScript and is distributed as both an ES Module and a CommonJS module.

## Building and Running

### Dependencies

The project's dependencies are managed with `npm`. Key dependencies include:
- **Peer Dependency**: `axios`
- **Dev Dependencies**: `typescript`, `vitest`, `esbuild`, `@biomejs/biome`

### Commands

The following `npm` scripts are available for building, testing, and linting the project:

- **Linting**:
  - `npm run lint`: Check the code for linting errors using Biome.
  - `npm run fix`: Automatically fix linting errors using Biome.

- **Building**:
  - `npm run compile`: Compiles the TypeScript source code into both ESM and CJS formats.
    - `npm run compile:esm`: Compiles to ES Module format using `tsc`.
    - `npm run compile:cjs`: Bundles the ESM output into a CommonJS module using `esbuild`.

- **Testing**:
  - `npm test`: Run the test suite using `vitest` and generate a coverage report. This command also runs the `compile` script beforehand.
  - `npm test:watch`: Run the tests in watch mode.

### Continuous Integration

The project uses GitHub Actions for continuous integration. The CI pipeline (`.github/workflows/ci.yaml`) runs the following checks on every push and pull request:
- **Linkinator**: Checks for broken links in the repository.
- **Testing**: Runs the test suite (`npm test`) on multiple versions of Node.js (20, 22, 24).
- **Linting**: Runs the linter (`npm run lint`).
- **License Check**: Checks for license compliance (`npm run license-check`).

## Development Conventions

### Coding Style

The project uses [Biome](https://biomejs.dev/) for code formatting and linting. The configuration is stored in `biome.json`. The coding style is enforced through the `npm run lint` script in the CI pipeline.

### Testing

The project uses [Vitest](https://vitest.dev/) for testing. Test files are located in the `test/` directory and are written in TypeScript (`.ts`) or CommonJS (`.cjs`). The configuration is in `vitest.config.mjs`. Code coverage is enabled and configured to report on the `src/` directory.

### TypeScript Configuration

The TypeScript configuration is in `tsconfig.json`. The project is configured to output to the `build/` directory.

### Submitting changes

This project does not allow committing directly to main.  For any changes, make sure to checkout a new branch, make changes there, and submit a PR. 
