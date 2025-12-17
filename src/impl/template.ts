/**
 * Template utilities for building SQL templates.
 *
 * This module provides the core primitives for the monadic template approach:
 * - Templates are tuples of {strings: TemplateStringsArray, values: unknown[]}
 * - Templates compose by merging (no string parsing)
 * - Identifiers use ident() markers for deferred quoting
 * - Rendering happens in drivers only
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A template tuple that can be composed and rendered.
 * Maintains invariant: strings.length === values.length + 1
 */
export interface TemplateTuple {
	readonly strings: TemplateStringsArray;
	readonly values: readonly unknown[];
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
 * @param template - Template to merge
 */
export function mergeTemplate(
	strings: string[],
	values: unknown[],
	template: TemplateTuple,
): void {
	// Append first template string to last accumulator string
	strings[strings.length - 1] += template.strings[0];
	// Push remaining template parts
	for (let i = 0; i < template.values.length; i++) {
		values.push(template.values[i]);
		strings.push(template.strings[i + 1]);
	}
}
