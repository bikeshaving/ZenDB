/**
 * @b9g/zen - The simple database client
 *
 * Define tables. Write SQL. Get objects.
 */

import {z as zod} from "zod";
import {extendZod} from "./impl/table.js";

// Extend zod on module load
extendZod(zod);

// Re-export extended zod
export {zod as z};

export {
	// Table definition
	table,
	isTable,
	type Table,
	type PartialTable,
	type DerivedTable,
	type TableOptions,
	type ReferenceInfo,
	type CompoundReference,

	// Zod extension (for advanced use cases)
	extendZod,

	// Custom field helpers
	setDBMeta,
	getDBMeta,

	// Field metadata
	type FieldMeta,
	type FieldType,
	type FieldDbMeta,

	// Type inference
	type Infer,
	type Insert,
	type FullTableOnly,

	// Fragment method types
	type SetValues,
} from "./impl/table.js";

export {
	// SQL dialect (for test utilities and DDL)
	type SQLDialect,
	// SQL fragments
	type SQLFragment,
	// DDL fragments
	type DDLFragment,
} from "./impl/query.js";

export {
	// SQL identifiers (table/column names quoted by drivers)
	ident,
	isSQLIdentifier,
	type SQLIdentifier,
} from "./impl/template.js";

export {
	// Database wrapper
	Database,
	Transaction,
	DatabaseUpgradeEvent,
	type Driver,
	type TaggedQuery,

	// SQL symbols (dialect-aware expressions resolved at query time)
	NOW,
	isSQLSymbol,
	type SQLSymbol,
} from "./impl/database.js";

export {
	// Errors
	ZealotError,
	ValidationError,
	TableDefinitionError,
	MigrationError,
	MigrationLockError,
	QueryError,
	NotFoundError,
	AlreadyExistsError,
	ConstraintViolationError,
	ConnectionError,
	TransactionError,
	isZealotError,
	hasErrorCode,
	type ZealotErrorCode,
} from "./impl/errors.js";
