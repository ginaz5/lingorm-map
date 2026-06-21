# JavaScript Type Checking Design

## Goal

Add static type checking to the existing JavaScript project without converting runtime source files to TypeScript. The initial rollout will focus on modules where object shapes, nullable state, callbacks, and third-party map SDK objects create the most risk.

## Scope

The first pass covers:

- `src/state.js`
- `src/csv-parser.js`
- `src/map.js`
- `src/forms.js`

The remaining JavaScript modules will continue to build and run unchanged and can be enrolled in type checking incrementally.

Documentation changes cover:

- `README.md`
- `note/LOCAL_TESTING.md`
- `note/TECH_DECISIONS.md`

## Approach

TypeScript will be installed as a development dependency and used only as a checker. Source files remain `.js`, Vite remains responsible for the production build, and the checker emits no files.

A `jsconfig.json` will configure modern JavaScript and DOM libraries, ES modules, strict checking, and `checkJs`. Its include list will explicitly name the four initial modules plus any shared declaration file needed for browser map SDK globals.

JSDoc will define the important application contracts:

- normalized location rows returned by the CSV parser;
- the shared application state shape;
- runtime map configuration;
- callbacks, DOM events, and nullable values used by map and form modules.

Google Maps and HERE Maps are loaded dynamically in the browser. Minimal ambient declarations will describe only the SDK surface used by this application. They are checker-only declarations and will not alter runtime behavior.

## Developer Workflow

`package.json` will expose:

```sh
npm run typecheck
```

This command will run TypeScript with `--noEmit`. Existing development and production commands remain unchanged.

## Validation

Implementation will use a configuration test first. The test will assert that the type-check command and checker configuration are present and scoped to the intended modules. It must fail before the configuration is added.

Completion requires all of the following to pass:

```sh
npm run typecheck
node --test tests/*.test.mjs
npm run build
```

## Documentation

The README will describe the type-checking command, clarify that the project remains JavaScript, and update the tech stack and local-development workflow.

`note/LOCAL_TESTING.md` will add type checking to local verification instructions. `note/TECH_DECISIONS.md` will record the decision to use incremental JSDoc-based checking instead of a full TypeScript migration, including its rationale and expansion path.

## Non-goals

- Renaming source files to `.ts`.
- Changing Vite or Netlify runtime behavior.
- Adding a frontend framework.
- Typing the complete public APIs of Google Maps or HERE Maps.
- Enrolling every source module in the first pass.
