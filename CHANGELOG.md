# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.7] - 2026-10-02

### Changed

- **`zod` is now a peer dependency only.** It was declared in both
  `dependencies` and `peerDependencies`, which is self-contradictory: the peer
  contract says the host provides zod, while the `dependencies` entry allowed a
  second copy to be installed alongside it. `@b9g/zen` now has zero runtime
  dependencies, so a consumer's bundle no longer risks carrying two copies of
  zod (#20).

  Your project must provide `zod` itself. npm installs the peer automatically,
  and upgrading in place keeps the copy you already have, so most projects need
  no change. Package managers that do not install peers automatically (yarn 1,
  or npm with `--legacy-peer-deps`) need an explicit `npm i zod`.

### Added

- `@b9g/zen/schema` entrypoint for using table and view definitions away from a
  database connection — form validation, API contracts, types shared between
  client and server. It excludes the database runtime, so it bundles about 65%
  smaller than the main entrypoint (#7).

### Fixed

- **A table interpolated into raw SQL is now expanded.** `db.exec`, `db.query`,
  `db.val` and `db.explain` sent the table object to the driver as a bound
  parameter, producing `near "?": syntax error` for the form the README
  documents. Tables and views are now quoted identifiers, as they already were
  in the typed methods.
- **`Table.values()` now encodes rows through the schema.** It validated rows
  but skipped encoding, so a `z.date()` column handed a `Date` straight to the
  driver and the binding was rejected. Objects, arrays and custom
  `.db.encode()` were skipped the same way. Encoding is applied where the
  dialect is known, so `values()` and `insert()` now write identical values for
  the same row.
- **`Insert<>` respects `.db.auto()`, `.db.inserted()` and `.db.upserted()`.**
  Generated fields were still required at the type level, so the README's own
  Quick Start did not compile even though the runtime was correct. `npm run
  typecheck` now covers the public API, including that example, so a type-level
  regression in the public surface fails the build.
- Two README `CREATE INDEX` examples used a table-qualified `cols` reference
  inside an index expression, which SQL does not allow. They use `ident()` on a
  bare column name instead.

## [0.1.6] - 2026-01-05

### Added

- `table.relations()` method for unified forward and reverse relation navigation
- `FieldMeta.schema` - raw Zod schema for direct introspection
- `FieldMeta.db` - raw database metadata from `.db.*()` methods
- `Relation` type export for typing relation navigators
- Chained relation navigation: `Users.relations().posts.fields().author.fields().email`

### Fixed

- Validation no longer runs on reads, matching documented behavior (#16)

### Deprecated

- `FieldMeta.type`, `FieldMeta.required`, and other cooked properties - use `schema` and `db` instead

## [0.1.5] - 2025-12-28

### Fixed

- `ensureTable()`, `ensureView()`, `ensureConstraints()`, `copyColumn()` no longer throw "cannot start a transaction within a transaction" when called inside `upgradeneeded` handler (#12)

## [0.1.4] - 2025-12-28

### Added

- `db.explain()` - Get query execution plan (EXPLAIN QUERY PLAN for SQLite, EXPLAIN for PostgreSQL/MySQL)
- `explain()` method on Driver interface - each driver owns its dialect-specific EXPLAIN syntax

### Fixed

- README documented fake APIs that never existed (`Users.ddl()`, `Posts.ensureColumn()`, `Posts.ensureIndex()`, `Users.copyColumn()`)
- README now documents the real APIs: `db.ensureTable()`, `db.ensureView()`, `db.ensureConstraints()`, `db.copyColumn()`

### Changed

- `getColumns()` is now required on Driver interface (was optional with fallback)
- Removed dialect-switching logic from database.ts - drivers own all dialect-specific behavior

## [0.1.3] - 2025-12-22

### Added

- Validation that compound constraints (`indexes`, `unique`, `references` options) have 2+ fields
  - Single-field constraints now throw `TableDefinitionError` with helpful message pointing to field-level API

### Fixed

- **TypeScript types now work in published package** - Updated libuild to fix module augmentation and `.d.ts` path resolution

### Changed

- New tagline: "Define Zod tables. Write raw SQL. Get typed objects."

### Documentation

- Added `.db.inserted()`, `.db.updated()`, `.db.upserted()` documentation with examples
- Added compound unique constraints example
- Fixed table naming consistency (all plural)
- Various README cleanups and improvements

## [0.1.2] - 2025-12-22

### Added

- New type exports: `PartialTable`, `DerivedTable`, `SetValues`, `FieldDBMeta`, `ReferenceInfo`, `CompoundReference`, `TaggedQuery`, `SQLDialect`, `isTable`
- Views documentation section in README
- `EnsureError` and `SchemaDriftError` documented in error types

### Changed

- Reorganized `zen.ts` exports into logical groups
- README Types section now accurately reflects actual exports (removed non-existent `SQLFragment`, `DDLFragment`, `DBExpression`)

### Fixed

- `isTable` type guard now exported (was missing)

## [0.1.1] - 2025-12-21

### Added

- Driver-level type encoding/decoding for dialect-specific handling
  - `encodeValue(value, fieldType)` and `decodeValue(value, fieldType)` methods on Driver interface
  - SQLite: Date→ISO string, boolean→1/0, JSON stringify/parse
  - MySQL: Date→"YYYY-MM-DD HH:MM:SS", boolean→1/0, JSON stringify/parse
  - PostgreSQL: Mostly passthrough (pg handles natively), JSON stringify
- `inferFieldType()` helper to infer field type from Zod schema
- Node.js tests for encode/decode functionality

### Changed

- **Breaking:** Removed deprecated `Infer<T>` type alias (use `Row<T>` instead)
- Renamed internal types for clarity:
  - `InferRefs` → `RowRefs`
  - `WithRefs` → `JoinedRow`

### Fixed

- Invalid datetime values now throw errors instead of returning Invalid Date

## [0.1.0] - 2025-12-20

Initial release of @b9g/zen - the simple database client.

### Features

- Table definitions with Zod schemas
- Explicit SQL queries with tagged templates
- Normalized object results from JOINs
- Multi-database support: SQLite, PostgreSQL, MySQL
- Bun.SQL driver with automatic dialect detection
- IndexedDB-style event-driven migrations
- Type-safe SQL fragment helpers (`set()`, `values()`, `on()`, `in()`)
- Forward and reverse relationship resolution
- Partial tables with `pick()` and SQL-computed fields with `derive()`
- DDL generation from schemas
- Form field metadata extraction
- Debugging tools (`db.print()`, `db.explain()`)
- Comprehensive error handling with typed errors

See README.md for complete documentation.
