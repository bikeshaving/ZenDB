/**
 * SQL rendering utilities for all dialects.
 *
 * This is the single source of truth for dialect-specific SQL rendering:
 * - Identifier quoting
 * - Placeholder syntax
 * - SQL builtin resolution
 * - Template rendering (for DDL and queries)
 */

import {isSQLIdentifier} from "./template.js";
import {isSQLBuiltin, resolveSQLBuiltin} from "./builtins.js";

// ============================================================================
// Types
// ============================================================================

export type SQLDialect = "sqlite" | "postgresql" | "mysql";

// ============================================================================
// Core Helpers
// ============================================================================

/**
 * Quote an identifier based on dialect.
 * MySQL uses backticks, PostgreSQL/SQLite use double quotes.
 */
export function quoteIdent(name: string, dialect: SQLDialect): string {
	if (dialect === "mysql") {
		return `\`${name.replace(/`/g, "``")}\``;
	}
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Get placeholder syntax based on dialect.
 * PostgreSQL uses $1, $2, etc. MySQL/SQLite use ?.
 */
export function placeholder(index: number, dialect: SQLDialect): string {
	if (dialect === "postgresql") {
		return `$${index}`;
	}
	return "?";
}

// Re-export for consumers that import from sql.ts
export {resolveSQLBuiltin} from "./builtins.js";

/**
 * Render a template to SQL string with parameters.
 * Handles SQLIdentifier markers and regular values.
 */
export function renderSQL(
	strings: TemplateStringsArray,
	values: readonly unknown[],
	dialect: SQLDialect,
): {sql: string; params: unknown[]} {
	let sql = "";
	const params: unknown[] = [];

	for (let i = 0; i < strings.length; i++) {
		sql += strings[i];
		if (i < values.length) {
			const value = values[i];
			if (isSQLIdentifier(value)) {
				sql += quoteIdent(value.name, dialect);
			} else {
				params.push(value);
				sql += placeholder(params.length, dialect);
			}
		}
	}

	return {sql, params};
}

/**
 * Render a DDL template to SQL string.
 * Handles identifiers (quoted), SQL builtins (resolved), and literal values (escaped/inlined).
 * Used for CREATE TABLE, CREATE VIEW, etc.
 */
export function renderDDL(
	strings: TemplateStringsArray,
	values: readonly unknown[],
	dialect: SQLDialect,
): string {
	let sql = "";
	for (let i = 0; i < strings.length; i++) {
		sql += strings[i];
		if (i < values.length) {
			const value = values[i];
			if (isSQLBuiltin(value)) {
				// Resolve SQL builtins (NOW, CURRENT_DATE, etc.) to their SQL representation
				sql += resolveSQLBuiltin(value);
			} else if (isSQLIdentifier(value)) {
				sql += quoteIdent(value.name, dialect);
			} else {
				// Inline literal values for DDL (CREATE VIEW WHERE clause, etc.)
				sql += inlineLiteral(value, dialect);
			}
		}
	}
	return sql;
}

/**
 * Convert a value to an inline SQL literal.
 * Used for DDL statements where parameter placeholders aren't supported.
 */
function inlineLiteral(value: unknown, dialect: SQLDialect): string {
	if (value === null || value === undefined) {
		return "NULL";
	}
	if (typeof value === "boolean") {
		// SQLite uses 0/1 for booleans
		if (dialect === "sqlite") {
			return value ? "1" : "0";
		}
		return value ? "TRUE" : "FALSE";
	}
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string") {
		// Escape single quotes by doubling them
		return `'${value.replace(/'/g, "''")}'`;
	}
	if (value instanceof Date) {
		return `'${value.toISOString()}'`;
	}
	// Fallback: stringify and escape
	return `'${String(value).replace(/'/g, "''")}'`;
}

// ============================================================================
// Query Building
// ============================================================================

/**
 * Build SQL from template parts with parameter placeholders.
 *
 * This is the shared implementation used by all Node drivers (MySQL, PostgreSQL, SQLite).
 * Handles SQLBuiltin symbols, SQLIdentifiers, and regular parameter values.
 *
 * SQL builtins and identifiers are inlined directly; other values use placeholders.
 */
export function buildSQL(
	strings: TemplateStringsArray,
	values: unknown[],
	dialect: SQLDialect,
): {sql: string; params: unknown[]} {
	let sql = strings[0];
	const params: unknown[] = [];

	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (isSQLBuiltin(value)) {
			// Inline the symbol's SQL directly
			sql += resolveSQLBuiltin(value) + strings[i + 1];
		} else if (isSQLIdentifier(value)) {
			// Quote identifier based on dialect
			sql += quoteIdent(value.name, dialect) + strings[i + 1];
		} else {
			// Add placeholder and keep value
			sql += placeholder(params.length + 1, dialect) + strings[i + 1];
			params.push(value);
		}
	}

	return {sql, params};
}
