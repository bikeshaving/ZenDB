/**
 * Template utilities for building SQL templates.
 *
 * This module provides the core primitives for the monadic template approach:
 * - Templates are branded tuples: [strings, values]
 * - Templates compose by merging (no string parsing)
 * - Identifiers use ident() markers for deferred quoting
 * - Rendering happens in drivers only
 */

// ============================================================================
// SQL Template
// ============================================================================

const SQL_TEMPLATE = Symbol.for("@b9g/zen:template");

/**
 * A SQL template as a branded tuple: [strings, ...values]
 *
 * Maintains invariant: strings.length === values.length + 1
 *
 * Access: template[0] for strings, template.slice(1) for values
 * The strings array preserves .raw for TemplateStringsArray compatibility.
 *
 * This structure matches template tag function parameters, allowing templates
 * to be directly applied to functions that accept (strings, ...values).
 *
 * Branded with symbol for injection protection - prevents user-crafted
 * objects from being interpolated as raw SQL.
 */
export type SQLTemplate = readonly [TemplateStringsArray, ...unknown[]] & {
	readonly [SQL_TEMPLATE]: true;
};

/**
 * Create a SQL template from strings and values.
 *
 * @param strings - TemplateStringsArray (preserves .raw)
 * @param values - Template values (identifiers, parameters, nested templates)
 */
export function createTemplate(
	strings: TemplateStringsArray,
	values: readonly unknown[] = [],
): SQLTemplate {
	const tuple = [strings, ...values] as const;
	return Object.assign(tuple, {[SQL_TEMPLATE]: true}) as SQLTemplate;
}

/**
 * Check if a value is a SQL template.
 */
export function isSQLTemplate(value: unknown): value is SQLTemplate {
	return (
		Array.isArray(value) &&
		Object.prototype.hasOwnProperty.call(value, SQL_TEMPLATE) &&
		(value as any)[SQL_TEMPLATE] === true
	);
}

// ============================================================================
// SQL Identifiers
// ============================================================================

const SQL_IDENT = Symbol.for("@b9g/zen:ident");

/**
 * SQL identifier (table name, column name) to be quoted by drivers.
 *
 * Identifiers flow through template composition unchanged.
 * Quoting happens in drivers based on dialect:
 * - MySQL: backticks (`name`)
 * - PostgreSQL/SQLite: double quotes ("name")
 */
export interface SQLIdentifier {
	readonly [SQL_IDENT]: true;
	readonly name: string;
}

/**
 * Create an SQL identifier marker.
 * Drivers will quote this appropriately for their dialect.
 */
export function ident(name: string): SQLIdentifier {
	return {[SQL_IDENT]: true, name};
}

/**
 * Check if a value is an SQL identifier marker.
 */
export function isSQLIdentifier(value: unknown): value is SQLIdentifier {
	return (
		value !== null &&
		typeof value === "object" &&
		SQL_IDENT in value &&
		(value as any)[SQL_IDENT] === true
	);
}

const SQL_ENCODABLE = Symbol.for("@b9g/zen:encodable");

/**
 * A value awaiting dialect-specific encoding.
 *
 * Carries the field type alongside the value so the encoding can be applied
 * once a driver is known, matching what insert()/update() produce for the
 * same column.
 */
export interface SQLEncodable {
	readonly [SQL_ENCODABLE]: true;
	readonly value: unknown;
	readonly fieldType: string;
}

/**
 * Create a value marked for dialect-specific encoding.
 */
export function encodable(value: unknown, fieldType: string): SQLEncodable {
	return {[SQL_ENCODABLE]: true, value, fieldType};
}

/**
 * Check if a value is awaiting dialect-specific encoding.
 */
export function isSQLEncodable(value: unknown): value is SQLEncodable {
	return (
		value !== null &&
		typeof value === "object" &&
		SQL_ENCODABLE in value &&
		(value as any)[SQL_ENCODABLE] === true
	);
}

/**
 * Minimal interface for driver encoding capability.
 * Defined here to avoid circular imports from database.ts.
 */
export interface DriverEncoder {
	encodeValue?(value: unknown, fieldType: string): unknown;
}

/**
 * Convert one app value to its database representation.
 *
 * Prefers the driver's dialect-specific encoding and otherwise falls back to a
 * format accepted by SQLite, PostgreSQL and MySQL alike.
 */
export function encodeFieldValue(
	value: unknown,
	fieldType: string,
	driver?: DriverEncoder,
): unknown {
	if (driver?.encodeValue) {
		return driver.encodeValue(value, fieldType);
	}

	if (fieldType === "json" && value !== null && value !== undefined) {
		return JSON.stringify(value);
	}

	if (
		fieldType === "datetime" &&
		value instanceof Date &&
		!isNaN(value.getTime())
	) {
		// UTC string: "YYYY-MM-DD HH:MM:SS.mmm". The Z is stripped because MySQL
		// doesn't accept it, but UTC semantics are preserved since toISOString()
		// always returns UTC time.
		return value.toISOString().replace("T", " ").replace("Z", "");
	}

	return value;
}

/**
 * Apply pending encodings to a template's values once a driver is known.
 */
export function resolveEncodables(
	values: unknown[],
	driver?: DriverEncoder,
): unknown[] {
	let found = false;
	for (const value of values) {
		if (isSQLEncodable(value)) {
			found = true;
			break;
		}
	}

	if (!found) {
		return values;
	}

	return values.map((value) =>
		isSQLEncodable(value)
			? encodeFieldValue(value.value, value.fieldType, driver)
			: value,
	);
}

// ============================================================================
// Template Building
// ============================================================================

/**
 * Build a TemplateStringsArray from string parts.
 * Used to construct templates programmatically while preserving the .raw property.
 */
export function makeTemplate(parts: string[]): TemplateStringsArray {
	return Object.assign([...parts], {raw: parts}) as TemplateStringsArray;
}

/**
 * Merge a template into an accumulator.
 * Mutates the strings and values arrays in place.
 *
 * @param strings - Accumulator strings array (mutated)
 * @param values - Accumulator values array (mutated)
 * @param template - Template to merge (tuple format)
 */
export function mergeTemplate(
	strings: string[],
	values: unknown[],
	template: SQLTemplate,
): void {
	const templateStrings = template[0];
	const templateValues = template.slice(1);
	// Append first template string to last accumulator string
	strings[strings.length - 1] += templateStrings[0];
	// Push remaining template parts
	for (let i = 0; i < templateValues.length; i++) {
		values.push(templateValues[i]);
		strings.push(templateStrings[i + 1]);
	}
}
