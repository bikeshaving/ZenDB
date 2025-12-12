/**
 * Table definition with wrapper-based field extensions.
 *
 * Uses wrapper functions instead of .pipe() to avoid Zod internals.
 * Metadata is extracted once at table() call time.
 */

import {z, ZodTypeAny, ZodObject, ZodRawShape} from "zod";
import {TableDefinitionError} from "./errors.js";

// ============================================================================
// Wrapper Types
// ============================================================================

const DB_FIELD = Symbol.for("@b9g/zealot:field");

interface FieldWrapper<T extends ZodTypeAny = ZodTypeAny> {
	[DB_FIELD]: true;
	schema: T;
	meta: FieldDbMeta;
}

function isFieldWrapper(value: unknown): value is FieldWrapper {
	return (
		value !== null &&
		typeof value === "object" &&
		DB_FIELD in value &&
		(value as any)[DB_FIELD] === true
	);
}

function createWrapper<T extends ZodTypeAny>(
	schema: T,
	meta: FieldDbMeta,
): FieldWrapper<T> {
	return {
		[DB_FIELD]: true,
		schema,
		meta,
	};
}

// ============================================================================
// Field Metadata
// ============================================================================

export interface FieldDbMeta {
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
	reference?: {
		table: Table<any>;
		field?: string; // defaults to primary key
		as: string;
		onDelete?: "cascade" | "set null" | "restrict";
	};
}

// ============================================================================
// Field Wrappers
// ============================================================================

/**
 * Mark a field as the primary key.
 *
 * @example
 * id: primary(z.string().uuid())
 */
export function primary<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {primaryKey: true});
}

/**
 * Mark a field as unique.
 *
 * @example
 * email: unique(z.string().email())
 */
export function unique<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {unique: true});
}

/**
 * Mark a field for indexing.
 *
 * @example
 * createdAt: index(z.date())
 */
export function index<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {indexed: true});
}

/**
 * Define a foreign key reference.
 *
 * @example
 * authorId: references(z.string().uuid(), users, { as: "author" })
 * authorId: references(z.string().uuid(), users, { field: "id", as: "author" })
 */
export function references<T extends ZodTypeAny>(
	schema: T,
	table: Table<any>,
	options: {
		field?: string;
		as: string;
		onDelete?: "cascade" | "set null" | "restrict";
	},
): FieldWrapper<T> {
	return createWrapper(schema, {
		reference: {
			table,
			field: options.field,
			as: options.as,
			onDelete: options.onDelete,
		},
	});
}

// ============================================================================
// Field Metadata Types (for forms/admin)
// ============================================================================

export type FieldType =
	| "text"
	| "textarea"
	| "email"
	| "url"
	| "tel"
	| "password"
	| "number"
	| "integer"
	| "checkbox"
	| "select"
	| "date"
	| "datetime"
	| "time"
	| "json"
	| "hidden";

export interface FieldMeta {
	name: string;
	type: FieldType;
	required: boolean;
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
	default?: unknown;
	maxLength?: number;
	minLength?: number;
	min?: number;
	max?: number;
	options?: readonly string[];
	reference?: {
		table: string;
		field: string;
		as: string;
	};
	/** Additional user-defined metadata from Zod's .meta() (label, helpText, widget, etc.) */
	[key: string]: unknown;
}

// ============================================================================
// Table
// ============================================================================

export interface TableOptions {
	indexes?: string[][];
}

// Symbol to identify Table objects
const TABLE_MARKER = Symbol.for("@b9g/zealot:table");

/**
 * Check if a value is a Table object.
 */
export function isTable(value: unknown): value is Table<any> {
	return (
		value !== null &&
		typeof value === "object" &&
		TABLE_MARKER in value &&
		(value as any)[TABLE_MARKER] === true
	);
}

export interface ReferenceInfo {
	fieldName: string;
	table: Table<any>;
	referencedField: string;
	as: string;
	onDelete?: "cascade" | "set null" | "restrict";
}

export interface Table<T extends ZodRawShape = ZodRawShape> {
	readonly [TABLE_MARKER]: true;
	readonly name: string;
	readonly schema: ZodObject<T>;
	readonly indexes: string[][];

	// Pre-extracted metadata (no Zod walking needed)
	readonly _meta: {
		primary: string | null;
		unique: string[];
		indexed: string[];
		references: ReferenceInfo[];
		fields: Record<string, FieldDbMeta>;
	};

	/** Get field metadata for forms/admin */
	fields(): Record<string, FieldMeta>;

	/** Get primary key field name */
	primaryKey(): string | null;

	/** Get all foreign key references */
	references(): ReferenceInfo[];

	/**
	 * Create a partial view of this table with only the specified fields.
	 *
	 * Useful for partial selects - the returned table-like object can be
	 * passed to all(), one(), where(), etc.
	 *
	 * @example
	 * const PostSummary = Posts.pick('id', 'title', 'authorId');
	 * db.all(PostSummary, Users.pick('id', 'name'))`...`
	 */
	pick<K extends keyof z.infer<ZodObject<T>>>(
		...fields: K[]
	): Table<Pick<T, K & keyof T>>;
}

type TableShape<T> = {
	[K in keyof T]: T[K] extends FieldWrapper<infer S> ? S : T[K];
};

/**
 * Define a database table with a Zod schema.
 *
 * @example
 * const users = table("users", {
 *   id: primary(z.string().uuid()),
 *   email: unique(z.string().email()),
 *   name: z.string().max(100),
 *   role: z.enum(["user", "admin"]).default("user"),
 * });
 */
export function table<T extends Record<string, ZodTypeAny | FieldWrapper>>(
	name: string,
	shape: T,
	options: TableOptions = {},
): Table<any> {
	// Validate table name doesn't contain dots (would break normalization)
	if (name.includes(".")) {
		throw new TableDefinitionError(
			`Invalid table name "${name}": table names cannot contain "." as it conflicts with normalization prefixes`,
			name,
		);
	}

	// Extract Zod schemas and metadata
	const zodShape: Record<string, ZodTypeAny> = {};
	const meta = {
		primary: null as string | null,
		unique: [] as string[],
		indexed: [] as string[],
		references: [] as ReferenceInfo[],
		fields: {} as Record<string, FieldDbMeta>,
	};

	for (const [key, value] of Object.entries(shape)) {
		// Validate field names don't contain dots (would break normalization)
		if (key.includes(".")) {
			throw new TableDefinitionError(
				`Invalid field name "${key}" in table "${name}": field names cannot contain "." as it conflicts with normalization prefixes`,
				name,
				key,
			);
		}
		if (isFieldWrapper(value)) {
			zodShape[key] = value.schema;
			meta.fields[key] = value.meta;

			if (value.meta.primaryKey) {
				meta.primary = key;
			}
			if (value.meta.unique) {
				meta.unique.push(key);
			}
			if (value.meta.indexed) {
				meta.indexed.push(key);
			}
			if (value.meta.reference) {
				const ref = value.meta.reference;
				meta.references.push({
					fieldName: key,
					table: ref.table,
					referencedField: ref.field ?? ref.table.primaryKey() ?? "id",
					as: ref.as,
					onDelete: ref.onDelete,
				});
			}
		} else {
			zodShape[key] = value as ZodTypeAny;
		}
	}

	const schema = z.object(zodShape as any);

	return createTableObject(name, schema, zodShape, meta, options.indexes ?? []);
}

/**
 * Create a Table object with all methods. Shared between table() and pick().
 */
function createTableObject(
	name: string,
	schema: ZodObject<any>,
	zodShape: Record<string, ZodTypeAny>,
	meta: {
		primary: string | null;
		unique: string[];
		indexed: string[];
		references: ReferenceInfo[];
		fields: Record<string, FieldDbMeta>;
	},
	indexes: string[][],
): Table<any> {
	return {
		[TABLE_MARKER]: true,
		name,
		schema,
		indexes,
		_meta: meta,

		fields(): Record<string, FieldMeta> {
			const result: Record<string, FieldMeta> = {};

			for (const [key, zodType] of Object.entries(zodShape)) {
				const dbMeta = meta.fields[key] || {};
				result[key] = extractFieldMeta(key, zodType, dbMeta);
			}

			return result;
		},

		primaryKey(): string | null {
			return meta.primary;
		},

		references(): ReferenceInfo[] {
			return meta.references;
		},

		pick(...fields: string[]): Table<any> {
			const fieldSet = new Set(fields);

			// Pick the schema fields
			const pickObj: Record<string, true> = {};
			for (const f of fields) {
				pickObj[f] = true;
			}
			const pickedSchema = schema.pick(pickObj);

			// Filter zodShape to only picked fields
			const pickedZodShape: Record<string, ZodTypeAny> = {};
			for (const f of fields) {
				if (f in zodShape) {
					pickedZodShape[f] = zodShape[f];
				}
			}

			// Filter metadata
			const pickedMeta = {
				primary: meta.primary && fieldSet.has(meta.primary) ? meta.primary : null,
				unique: meta.unique.filter((f) => fieldSet.has(f)),
				indexed: meta.indexed.filter((f) => fieldSet.has(f)),
				references: meta.references.filter((r) => fieldSet.has(r.fieldName)),
				fields: Object.fromEntries(
					Object.entries(meta.fields).filter(([k]) => fieldSet.has(k)),
				),
			};

			// Filter indexes to only those with all fields present
			const pickedIndexes = indexes.filter((idx) =>
				idx.every((f) => fieldSet.has(f)),
			);

			return createTableObject(
				name,
				pickedSchema,
				pickedZodShape,
				pickedMeta,
				pickedIndexes,
			);
		},
	};
}

// ============================================================================
// Field Metadata Extraction (using only public Zod APIs)
// ============================================================================

interface UnwrapResult {
	core: z.ZodType;
	isOptional: boolean;
	isNullable: boolean;
	hasDefault: boolean;
	defaultValue?: unknown;
	/** Collected .meta() from all layers, merged (outer overrides inner) */
	collectedMeta: Record<string, unknown>;
}

/**
 * Extract .meta() from a single schema layer.
 */
function getLayerMeta(schema: z.ZodType): Record<string, unknown> {
	if (typeof (schema as any).meta === "function") {
		return (schema as any).meta() ?? {};
	}
	return {};
}

/**
 * Unwrap wrapper types using public Zod APIs only.
 * No _def access - uses removeDefault(), unwrap(), innerType(), etc.
 * Collects .meta() from all layers during unwrapping.
 */
function unwrapType(schema: z.ZodType): UnwrapResult {
	let core: z.ZodType = schema;
	let hasDefault = false;
	let defaultValue: unknown = undefined;

	// Collect meta from all layers (will merge at the end, outer wins)
	const metaLayers: Record<string, unknown>[] = [];

	// Use public isOptional/isNullable
	const isOptional = schema.isOptional();
	const isNullable = schema.isNullable();

	// Unwrap layers using public methods, collecting meta at each step
	while (true) {
		// Collect meta from current layer
		metaLayers.push(getLayerMeta(core));

		// Check for ZodDefault (has removeDefault method)
		if (typeof (core as any).removeDefault === "function") {
			hasDefault = true;
			try {
				defaultValue = core.parse(undefined);
			} catch {
				// Default might be a function that throws
			}
			core = (core as any).removeDefault();
			continue;
		}

		// Check for ZodOptional/ZodNullable (has unwrap method)
		if (typeof (core as any).unwrap === "function") {
			core = (core as any).unwrap();
			continue;
		}

		// Check for ZodEffects (has innerType method)
		if (typeof (core as any).innerType === "function") {
			core = (core as any).innerType();
			continue;
		}

		// No more wrappers
		break;
	}

	// Merge meta: inner layers first, outer layers override
	// metaLayers[0] is outermost, metaLayers[n-1] is innermost
	// Spread in reverse so outer wins
	const collectedMeta: Record<string, unknown> = {};
	for (let i = metaLayers.length - 1; i >= 0; i--) {
		Object.assign(collectedMeta, metaLayers[i]);
	}

	return {core, isOptional, isNullable, hasDefault, defaultValue, collectedMeta};
}

/**
 * Extract field metadata using instanceof checks and public properties.
 * No _def access. Merges Zod 4 .meta() for Shovel UI metadata.
 */
function extractFieldMeta(
	name: string,
	zodType: ZodTypeAny,
	dbMeta: FieldDbMeta,
): FieldMeta {
	const {core, isOptional, isNullable, hasDefault, defaultValue, collectedMeta} = unwrapType(zodType);

	const meta: FieldMeta = {
		name,
		type: "text",
		required: !isOptional && !isNullable && !hasDefault,
		...collectedMeta, // Spread user-defined metadata (label, helpText, widget, etc.)
	};

	// Apply database metadata
	if (dbMeta.primaryKey) meta.primaryKey = true;
	if (dbMeta.unique) meta.unique = true;
	if (dbMeta.indexed) meta.indexed = true;
	if (dbMeta.reference) {
		meta.reference = {
			table: dbMeta.reference.table.name,
			field: dbMeta.reference.field ?? dbMeta.reference.table.primaryKey() ?? "id",
			as: dbMeta.reference.as,
		};
	}

	if (defaultValue !== undefined) {
		meta.default = defaultValue;
	}

	// Determine field type using instanceof and public properties
	if (core instanceof z.ZodString) {
		meta.type = "text";

		// Use public properties for string checks
		const str = core as any;
		// Zod 4 uses .format, Zod 3 uses .isEmail/.isURL
		if (str.format === "email" || str.isEmail) meta.type = "email";
		if (str.format === "url" || str.isURL) meta.type = "url";
		if (str.maxLength !== undefined) {
			meta.maxLength = str.maxLength;
			if (str.maxLength > 500) meta.type = "textarea";
		}
		if (str.minLength !== undefined) {
			meta.minLength = str.minLength;
		}
	} else if (core instanceof z.ZodNumber) {
		meta.type = "number";

		// Use public properties for number checks
		const num = core as any;
		// Zod 4 uses .format for "int", Zod 3 uses .isInt
		if (num.format === "int" || num.isInt) meta.type = "integer";
		if (num.minValue !== undefined) meta.min = num.minValue;
		if (num.maxValue !== undefined) meta.max = num.maxValue;
	} else if (core instanceof z.ZodBoolean) {
		meta.type = "checkbox";
	} else if (core instanceof z.ZodDate) {
		meta.type = "datetime";
	} else if (core instanceof z.ZodEnum) {
		meta.type = "select";
		// Use public options property
		meta.options = (core as any).options;
	} else if (core instanceof z.ZodArray || core instanceof z.ZodObject) {
		meta.type = "json";
	}

	return meta;
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer the TypeScript type from a table (full document after read).
 */
export type Infer<T extends Table<any>> = z.infer<T["schema"]>;

/**
 * Infer the insert type (respects defaults).
 */
export type Insert<T extends Table<any>> = z.input<T["schema"]>;
