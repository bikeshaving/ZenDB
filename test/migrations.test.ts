import {test, expect, describe, mock} from "bun:test";
import {
	Database,
	DatabaseUpgradeEvent,
	type Driver,
} from "../src/impl/database.js";
import {table, z} from "../src/zen.js";

// Helper to build SQL from template parts
function buildSql(strings: TemplateStringsArray): string {
	return strings.join("?");
}

// In-memory SQLite-like driver for testing
function createTestDriver(): Driver & {tables: Map<string, any[]>} {
	const tables = new Map<string, any[]>();

	const driver: Driver & {tables: Map<string, any[]>} = {
		supportsReturning: true,
		tables,
		async all<T>(
			strings: TemplateStringsArray,
			_values: unknown[],
		): Promise<T[]> {
			const sql = buildSql(strings);
			// Simple mock - just handle _migrations table
			if (sql.includes("_migrations")) {
				return (tables.get("_migrations") ?? []) as T[];
			}
			return [];
		},
		async get<T>(
			strings: TemplateStringsArray,
			_values: unknown[],
		): Promise<T | null> {
			const sql = buildSql(strings);
			if (sql.includes("MAX(version)")) {
				const migrations = tables.get("_migrations") ?? [];
				if (migrations.length === 0) return {version: null} as T;
				const maxVersion = Math.max(...migrations.map((m: any) => m.version));
				return {version: maxVersion} as T;
			}
			return null;
		},
		async run(
			strings: TemplateStringsArray,
			values: unknown[],
		): Promise<number> {
			const sql = buildSql(strings);
			if (sql.includes("CREATE TABLE") && sql.includes("_migrations")) {
				if (!tables.has("_migrations")) {
					tables.set("_migrations", []);
				}
				return 0;
			}
			if (sql.includes("INSERT INTO") && sql.includes("_migrations")) {
				const migrations = tables.get("_migrations") ?? [];
				migrations.push({
					version: values[0],
					applied_at: new Date().toISOString(),
				});
				tables.set("_migrations", migrations);
				return 1;
			}
			// Track other table creations for testing
			const createMatch = sql.match(/CREATE TABLE.*?"(\w+)"/);
			if (createMatch) {
				tables.set(createMatch[1], []);
				return 0;
			}
			return 0;
		},
		async val<T>(
			_strings: TemplateStringsArray,
			_values: unknown[],
		): Promise<T | null> {
			return 0 as T;
		},
		async close(): Promise<void> {
			// No-op for test driver
		},
		async transaction<T>(fn: (txDriver: Driver) => Promise<T>): Promise<T> {
			// Simple transaction - just execute the function with this driver
			return await fn(driver);
		},
	};

	return driver;
}

describe("Database migrations", () => {
	describe("open()", () => {
		test("creates _migrations table on first open", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			await db.open(1);

			expect(driver.tables.has("_migrations")).toBe(true);
		});

		test("sets version after open", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			expect(db.version).toBe(0);
			await db.open(1);
			expect(db.version).toBe(1);
		});

		test("throws if already opened", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			await db.open(1);
			await expect(db.open(2)).rejects.toThrow("Database already opened");
		});
	});

	describe("upgradeneeded event", () => {
		test("fires on fresh database", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);
			const handler = mock(() => {});

			db.addEventListener("upgradeneeded", handler);
			await db.open(1);

			expect(handler).toHaveBeenCalledTimes(1);
		});

		test("includes oldVersion and newVersion", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);
			let capturedEvent: DatabaseUpgradeEvent | null = null;

			db.addEventListener("upgradeneeded", (e) => {
				capturedEvent = e as DatabaseUpgradeEvent;
			});
			await db.open(2);

			expect(capturedEvent).not.toBeNull();
			expect(capturedEvent!.oldVersion).toBe(0);
			expect(capturedEvent!.newVersion).toBe(2);
		});

		test("fires with correct oldVersion on upgrade", async () => {
			const driver = createTestDriver();
			// Pre-populate with version 1
			driver.tables.set("_migrations", [
				{version: 1, applied_at: "2024-01-01"},
			]);

			const db = new Database(driver);
			let capturedEvent: DatabaseUpgradeEvent | null = null;

			db.addEventListener("upgradeneeded", (e) => {
				capturedEvent = e as DatabaseUpgradeEvent;
			});
			await db.open(2);

			expect(capturedEvent!.oldVersion).toBe(1);
			expect(capturedEvent!.newVersion).toBe(2);
		});

		test("does NOT fire if version matches", async () => {
			const driver = createTestDriver();
			driver.tables.set("_migrations", [
				{version: 2, applied_at: "2024-01-01"},
			]);

			const db = new Database(driver);
			const handler = mock(() => {});

			db.addEventListener("upgradeneeded", handler);
			await db.open(2);

			expect(handler).not.toHaveBeenCalled();
		});

		test("does NOT fire if requested version is lower", async () => {
			const driver = createTestDriver();
			driver.tables.set("_migrations", [
				{version: 3, applied_at: "2024-01-01"},
			]);

			const db = new Database(driver);
			const handler = mock(() => {});

			db.addEventListener("upgradeneeded", handler);
			await db.open(2);

			expect(handler).not.toHaveBeenCalled();
			expect(db.version).toBe(2);
		});
	});

	describe("waitUntil()", () => {
		test("open() waits for waitUntil promises", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);
			let migrationComplete = false;

			db.addEventListener("upgradeneeded", (e) => {
				const event = e as DatabaseUpgradeEvent;
				event.waitUntil(
					(async () => {
						// Simulate async migration work
						await new Promise((r) => setTimeout(r, 10));
						migrationComplete = true;
					})(),
				);
			});

			await db.open(1);
			expect(migrationComplete).toBe(true);
		});

		test("multiple waitUntil calls all complete", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);
			const completed: number[] = [];

			db.addEventListener("upgradeneeded", (e) => {
				const event = e as DatabaseUpgradeEvent;
				event.waitUntil(
					(async () => {
						await new Promise((r) => setTimeout(r, 5));
						completed.push(1);
					})(),
				);
				event.waitUntil(
					(async () => {
						await new Promise((r) => setTimeout(r, 10));
						completed.push(2);
					})(),
				);
			});

			await db.open(1);
			expect(completed).toContain(1);
			expect(completed).toContain(2);
		});

		test("multiple listeners all complete", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);
			const completed: string[] = [];

			db.addEventListener("upgradeneeded", (e) => {
				(e as DatabaseUpgradeEvent).waitUntil(
					(async () => {
						completed.push("listener1");
					})(),
				);
			});

			db.addEventListener("upgradeneeded", (e) => {
				(e as DatabaseUpgradeEvent).waitUntil(
					(async () => {
						completed.push("listener2");
					})(),
				);
			});

			await db.open(1);
			expect(completed).toContain("listener1");
			expect(completed).toContain("listener2");
		});

		test("migration errors reject open()", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			db.addEventListener("upgradeneeded", (e) => {
				(e as DatabaseUpgradeEvent).waitUntil(
					Promise.reject(new Error("Migration failed")),
				);
			});

			await expect(db.open(1)).rejects.toThrow("Migration failed");
		});
	});

	describe("version tracking", () => {
		test("version is recorded in _migrations table", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			await db.open(3);

			const migrations = driver.tables.get("_migrations")!;
			expect(migrations.some((m: any) => m.version === 3)).toBe(true);
		});

		test("version not recorded if migration fails", async () => {
			const driver = createTestDriver();
			const db = new Database(driver);

			db.addEventListener("upgradeneeded", (e) => {
				(e as DatabaseUpgradeEvent).waitUntil(
					Promise.reject(new Error("Failed")),
				);
			});

			try {
				await db.open(2);
			} catch {
				// Expected
			}

			const migrations = driver.tables.get("_migrations") ?? [];
			expect(migrations.some((m: any) => m.version === 2)).toBe(false);
		});
	});
});

describe("DatabaseUpgradeEvent", () => {
	test("is an Event", () => {
		const event = new DatabaseUpgradeEvent("upgradeneeded", {
			oldVersion: 0,
			newVersion: 1,
		});
		expect(event).toBeInstanceOf(Event);
		expect(event.type).toBe("upgradeneeded");
	});

	test("has oldVersion and newVersion", () => {
		const event = new DatabaseUpgradeEvent("upgradeneeded", {
			oldVersion: 1,
			newVersion: 3,
		});
		expect(event.oldVersion).toBe(1);
		expect(event.newVersion).toBe(3);
	});

	test("waitUntil collects promises", async () => {
		const event = new DatabaseUpgradeEvent("upgradeneeded", {
			oldVersion: 0,
			newVersion: 1,
		});

		let resolved = false;
		event.waitUntil(
			(async () => {
				resolved = true;
			})(),
		);

		await event._settle();
		expect(resolved).toBe(true);
	});
});

// =============================================================================
// Regression: Migration race condition (Issue #2)
// =============================================================================

describe("Migration race condition", () => {
	test("ensureMigrationsTable should be called inside lock", async () => {
		// This verifies the code path ensures #ensureMigrationsTable is called
		// within withMigrationLock

		let lockAcquired = false;
		let tableCreatedWhileLocked = false;

		const driver: Driver = {
			supportsReturning: true,
			all: async () => [],
			get: async (strings: TemplateStringsArray) => {
				const sql = buildSql(strings);
				if (sql.includes("MAX(version)")) {
					return {version: 0} as any;
				}
				return null;
			},
			run: async (strings: TemplateStringsArray) => {
				const sql = buildSql(strings);
				if (sql.includes("CREATE TABLE") && sql.includes("_migrations")) {
					tableCreatedWhileLocked = lockAcquired;
				}
				return 0;
			},
			val: async () => null,
			close: async () => {},
			transaction: async (fn) => fn(driver),
			withMigrationLock: async (fn) => {
				lockAcquired = true;
				try {
					return await fn();
				} finally {
					lockAcquired = false;
				}
			},
		};

		const db = new Database(driver);
		await db.open(1);

		// The migrations table should be created while the lock is held
		expect(tableCreatedWhileLocked).toBe(true);
	});
});

// =============================================================================
// Regression: ensureTable inside upgrade handler (Issue #12)
// =============================================================================

describe("ensureTable inside upgrade handler", () => {
	test("should not throw nested transaction error", async () => {
		let ensureTableCalled = false;
		let nestedLockAttempted = false;

		const driver: Driver = {
			supportsReturning: true,
			all: async () => [],
			get: async (strings: TemplateStringsArray) => {
				const sql = buildSql(strings);
				if (sql.includes("MAX(version)")) {
					return {version: 0} as any;
				}
				return null;
			},
			run: async () => 0,
			val: async () => null,
			close: async () => {},
			transaction: async (fn) => fn(driver),
			getColumns: async () => [],
			explain: async () => [],
			withMigrationLock: async (fn) => {
				// Track if we're trying to nest locks
				if (nestedLockAttempted) {
					throw new Error("cannot start a transaction within a transaction");
				}
				nestedLockAttempted = true;
				try {
					return await fn();
				} finally {
					nestedLockAttempted = false;
				}
			},
			ensureTable: async () => {
				ensureTableCalled = true;
				return {applied: true};
			},
		};

		const db = new Database(driver);

		const Users = table("users", {
			id: z.string(),
		});

		db.addEventListener("upgradeneeded", (e) => {
			(e as DatabaseUpgradeEvent).waitUntil(
				(async () => {
					// This should NOT throw "cannot start a transaction within a transaction"
					await db.ensureTable(Users);
				})(),
			);
		});

		// This should not throw
		await db.open(1);

		expect(ensureTableCalled).toBe(true);
	});

	test("multiple ensureTable calls should work inside upgrade handler", async () => {
		const ensuredTables: string[] = [];
		let lockDepth = 0;
		let maxLockDepth = 0;

		const driver: Driver = {
			supportsReturning: true,
			all: async () => [],
			get: async (strings: TemplateStringsArray) => {
				const sql = buildSql(strings);
				if (sql.includes("MAX(version)")) {
					return {version: 0} as any;
				}
				return null;
			},
			run: async () => 0,
			val: async () => null,
			close: async () => {},
			transaction: async (fn) => fn(driver),
			getColumns: async () => [],
			explain: async () => [],
			withMigrationLock: async (fn) => {
				lockDepth++;
				maxLockDepth = Math.max(maxLockDepth, lockDepth);
				if (lockDepth > 1) {
					throw new Error("cannot start a transaction within a transaction");
				}
				try {
					return await fn();
				} finally {
					lockDepth--;
				}
			},
			ensureTable: async (tbl: any) => {
				ensuredTables.push(tbl.name || "unknown");
				return {applied: true};
			},
		};

		const db = new Database(driver);

		const Users = table("users", {id: z.string()});
		const Posts = table("posts", {id: z.string()});
		const Tags = table("tags", {id: z.string()});

		db.addEventListener("upgradeneeded", (e) => {
			(e as DatabaseUpgradeEvent).waitUntil(
				(async () => {
					await db.ensureTable(Users);
					await db.ensureTable(Posts);
					await db.ensureTable(Tags);
				})(),
			);
		});

		// This should not throw
		await db.open(1);

		expect(ensuredTables).toEqual(["users", "posts", "tags"]);
		// Lock should only be acquired once (at the open level), not for each ensureTable
		expect(maxLockDepth).toBe(1);
	});
});
