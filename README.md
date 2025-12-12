# Zealot

Schema-driven database client for TypeScript. Replaces ORMs (Prisma, Drizzle ORM), query builders (Kysely), and raw client wrappers with a single SQL-first library built on Zod schemas.

**Not an ORM** — a thin wrapper over SQL that uses Zod schemas to define storage, validation, and metadata in one place.

## Packages

- **[@b9g/zealot](./packages/zealot)** - Core library
- **[@b9g/zealot-postgres](./packages/zealot-postgres)** - PostgreSQL adapter (postgres.js)
- **[@b9g/zealot-mysql](./packages/zealot-mysql)** - MySQL adapter (mysql2)
- **[@b9g/zealot-sqlite](./packages/zealot-sqlite)** - SQLite adapter (better-sqlite3)

The core library also includes:
- **@b9g/zealot/bun-sql** - Bun.SQL adapter (subpath export)

## Quick Start

See [packages/zealot/README.md](./packages/zealot/README.md) for comprehensive documentation.

## License

MIT
