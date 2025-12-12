/**
 * SQL Fragment Helpers
 *
 * Type-safe helpers that generate SQL fragments without emitting keywords.
 * All fragments are composable inside tagged templates.
 */

import type {Table, Infer, ColumnCasing} from "./table.js";
import {createFragment, type SQLFragment} from "./query.js";

// ============================================================================
// Operator DSL Types
// ============================================================================

/**
 * Condition operators for where/having clauses.
 */
export type ConditionOperators<T> = {
	$eq?: T;
	$lt?: T;
	$gt?: T;
	$lte?: T;
	$gte?: T;
	$like?: string;
	$in?: T[];
	$neq?: T;
	$isNull?: boolean;
};

/**
 * A condition value can be a plain value (shorthand for $eq) or an operator object.
 */
export type ConditionValue<T> = T | ConditionOperators<T>;

/**
 * Where conditions for a table - keys must exist in table schema.
 */
export type WhereConditions<T extends Table<any>> = {
	[K in keyof Infer<T>]?: ConditionValue<Infer<T>[K]>;
};

/**
 * Set values for updates - plain values only (no operators).
 */
export type SetValues<T extends Table<any>> = {
	[K in keyof Infer<T>]?: Infer<T>[K];
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a field name to snake_case for SQL.
 */
function toSnakeCase(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert a field name to a column name based on the casing convention.
 */
function toColumnName(field: string, casing: ColumnCasing): string {
	if (casing === "snake_case") {
		return toSnakeCase(field);
	}
	return field; // camelCase or none
}

/**
 * Check if a value is an operator object.
 */
function isOperatorObject(value: unknown): value is ConditionOperators<unknown> {
	if (value === null || typeof value !== "object") return false;
	const keys = Object.keys(value);
	return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

/**
 * Build a condition fragment for a single field.
 */
function buildCondition(
	column: string,
	value: ConditionValue<unknown>,
): {sql: string; params: unknown[]} {
	if (isOperatorObject(value)) {
		const parts: string[] = [];
		const params: unknown[] = [];

		if (value.$eq !== undefined) {
			parts.push(`${column} = ?`);
			params.push(value.$eq);
		}
		if (value.$neq !== undefined) {
			parts.push(`${column} != ?`);
			params.push(value.$neq);
		}
		if (value.$lt !== undefined) {
			parts.push(`${column} < ?`);
			params.push(value.$lt);
		}
		if (value.$gt !== undefined) {
			parts.push(`${column} > ?`);
			params.push(value.$gt);
		}
		if (value.$gte !== undefined) {
			parts.push(`${column} >= ?`);
			params.push(value.$gte);
		}
		if (value.$lte !== undefined) {
			parts.push(`${column} <= ?`);
			params.push(value.$lte);
		}
		if (value.$like !== undefined) {
			parts.push(`${column} LIKE ?`);
			params.push(value.$like);
		}
		if (value.$in !== undefined && Array.isArray(value.$in)) {
			const placeholders = value.$in.map(() => "?").join(", ");
			parts.push(`${column} IN (${placeholders})`);
			params.push(...value.$in);
		}
		if (value.$isNull !== undefined) {
			parts.push(value.$isNull ? `${column} IS NULL` : `${column} IS NOT NULL`);
		}

		return {
			sql: parts.join(" AND "),
			params,
		};
	}

	// Plain value = $eq shorthand
	return {
		sql: `${column} = ?`,
		params: [value],
	};
}

// ============================================================================
// Fragment Helpers
// ============================================================================

/**
 * Generate an AND-joined conditional fragment for WHERE clauses.
 *
 * @example
 * db.all(Posts)`
 *   WHERE ${where(Posts, { published: true, createdAt: { $gt: oneMonthAgo } })}
 * `
 * // Output: published = ? AND created_at > ?
 *
 * @example
 * // With camelCase columns (set via table options)
 * const Posts = table("posts", {...}, { casing: "camelCase" });
 * where(Posts, { createdAt: { $gt: oneMonthAgo } })
 * // Output: createdAt > ?
 */
export function where<T extends Table<any>>(
	table: T,
	conditions: WhereConditions<T>,
): SQLFragment {
	const casing = table._meta.casing;
	const entries = Object.entries(conditions);
	if (entries.length === 0) {
		return createFragment("1 = 1", []);
	}

	const parts: string[] = [];
	const params: unknown[] = [];

	for (const [field, value] of entries) {
		if (value === undefined) continue;

		const column = toColumnName(field, casing);
		const condition = buildCondition(column, value);
		parts.push(condition.sql);
		params.push(...condition.params);
	}

	if (parts.length === 0) {
		return createFragment("1 = 1", []);
	}

	return createFragment(parts.join(" AND "), params);
}

/**
 * Generate assignment fragment for UPDATE SET clauses.
 *
 * @example
 * db.exec`
 *   UPDATE posts
 *   SET ${set(Posts, { title: "New Title", updatedAt: new Date() })}
 *   WHERE id = ${id}
 * `
 * // Output: title = ?, updated_at = ?
 *
 * @example
 * // With camelCase columns (set via table options)
 * const Posts = table("posts", {...}, { casing: "camelCase" });
 * set(Posts, { updatedAt: new Date() })
 * // Output: updatedAt = ?
 */
export function set<T extends Table<any>>(
	table: T,
	values: SetValues<T>,
): SQLFragment {
	const casing = table._meta.casing;
	const entries = Object.entries(values);
	if (entries.length === 0) {
		throw new Error("set() requires at least one field");
	}

	const parts: string[] = [];
	const params: unknown[] = [];

	for (const [field, value] of entries) {
		if (value === undefined) continue;

		const column = toColumnName(field, casing);
		parts.push(`${column} = ?`);
		params.push(value);
	}

	if (parts.length === 0) {
		throw new Error("set() requires at least one non-undefined field");
	}

	return createFragment(parts.join(", "), params);
}

/**
 * Generate foreign-key equality fragment for JOIN ON clauses.
 *
 * @example
 * db.all(Posts, Users)`
 *   JOIN users ON ${on(Posts, "authorId")}
 * `
 * // Output: users.id = posts.author_id
 *
 * @example
 * // With camelCase columns (set via table options)
 * const Posts = table("posts", {...}, { casing: "camelCase" });
 * on(Posts, "authorId")
 * // Output: users.id = posts.authorId
 */
export function on<T extends Table<any>>(
	table: T,
	field: keyof Infer<T> & string,
): SQLFragment {
	const casing = table._meta.casing;
	const refs = table.references();
	const ref = refs.find((r) => r.fieldName === field);

	if (!ref) {
		throw new Error(
			`Field "${field}" is not a foreign key reference in table "${table.name}"`,
		);
	}

	const fkColumn = toColumnName(field, casing);
	const refTable = ref.table.name;
	const refColumn = toColumnName(ref.referencedField, ref.table._meta.casing);

	return createFragment(`${refTable}.${refColumn} = ${table.name}.${fkColumn}`, []);
}
