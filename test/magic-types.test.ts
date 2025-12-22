/**
 * Type tests for magic join types.
 * These tests verify that db.all([Posts, Users]) returns properly typed results.
 */
import {test, expect, describe} from "bun:test";
import {z} from "zod";
import {table, extendZod, type Row, type WithRefs} from "../src/impl/table.js";
import {Database} from "../src/impl/database.js";
import BunSQLiteDriver from "../src/bun.js";

// Extend Zod before tests
extendZod(z);

// Define tables with relationships
const Users = table("users", {
	id: z.string().db.primary(),
	name: z.string(),
});

const Posts = table("posts", {
	id: z.string().db.primary(),
	title: z.string(),
	authorId: z.string().db.references(Users, "author"),
});

describe("Magic Join Types", () => {
	test("type inference works correctly", () => {
		// Single table result type should NOT have .author
		type SingleResult = Row<typeof Posts>;
		const singleCheck: SingleResult = {
			id: "123",
			title: "Hello",
			authorId: "456",
		};
		expect(singleCheck.id).toBe("123");
	});

	test("WithRefs type adds optional relationship properties", () => {
		// WithRefs<Posts, [Users]> should include optional author
		type JoinedResult = WithRefs<typeof Posts, [typeof Users]>;

		const joinedCheck: JoinedResult = {
			id: "123",
			title: "Hello",
			authorId: "456",
			author: {
				id: "456",
				name: "Alice",
			},
		};

		// author is optional (for LEFT JOINs or missing FKs)
		expect(joinedCheck.author?.name).toBe("Alice");
	});

	test("db.all with multiple tables returns typed results", async () => {
		const driver = new BunSQLiteDriver(":memory:");
		const db = new Database(driver);
		await db.open(1);

		// Create tables
		await db.ensureTable(Users);
		await db.ensureTable(Posts);

		// Insert test data
		await db.insert(Users, {id: "u1", name: "Alice"});
		await db.insert(Posts, {id: "p1", title: "Hello", authorId: "u1"});

		// Query with join - should have typed author property!
		const posts = await db.all([Posts, Users])`
			JOIN "users" ON ${Users.on(Posts)}
		`;

		expect(posts.length).toBe(1);
		expect(posts[0].title).toBe("Hello");
		// This is the magic - author is typed (optional since joins may not match)
		expect(posts[0].author?.name).toBe("Alice");

		await driver.close();
	});

	test("db.get with multiple tables returns typed result", async () => {
		const driver = new BunSQLiteDriver(":memory:");
		const db = new Database(driver);
		await db.open(1);

		await db.ensureTable(Users);
		await db.ensureTable(Posts);
		await db.insert(Users, {id: "u1", name: "Bob"});
		await db.insert(Posts, {id: "p1", title: "World", authorId: "u1"});

		const post = await db.get([Posts, Users])`
			JOIN "users" ON ${Users.on(Posts)}
			WHERE ${Posts.cols.id} = ${"p1"}
		`;

		expect(post).not.toBeNull();
		expect(post!.title).toBe("World");
		// Magic typing (optional since joins may not match)
		expect(post!.author?.name).toBe("Bob");

		await driver.close();
	});

	test("derived properties are typed correctly", () => {
		// Define a table with derived properties
		const Articles = table(
			"articles",
			{
				id: z.string().db.primary(),
				title: z.string(),
				body: z.string(),
			},
			{
				derive: {
					titleUpper: (a) => a.title.toUpperCase(),
					wordCount: (a) => a.body.split(" ").length,
					summary: (a) => a.body.slice(0, 100),
				},
			},
		);

		// Row type should include both schema fields and derived properties
		type Article = Row<typeof Articles>;

		// Type check: these should compile
		const article: Article = {
			id: "1",
			title: "Hello",
			body: "Hello world this is a test",
			titleUpper: "HELLO",
			wordCount: 6,
			summary: "Hello world this is a test",
		};

		expect(article.id).toBe("1");
		expect(article.titleUpper).toBe("HELLO");
		expect(article.wordCount).toBe(6);
	});

	test("derived properties work at runtime", async () => {
		const Articles = table(
			"articles",
			{
				id: z.string().db.primary(),
				title: z.string(),
				body: z.string(),
			},
			{
				derive: {
					titleUpper: (a) => a.title.toUpperCase(),
					wordCount: (a) => a.body.split(" ").length,
				},
			},
		);

		const driver = new BunSQLiteDriver(":memory:");
		const db = new Database(driver);
		await db.open(1);
		await db.ensureTable(Articles);

		await db.insert(Articles, {
			id: "a1",
			title: "Hello World",
			body: "This is a test article with several words",
		});

		const article = await db.get(Articles)`
			WHERE ${Articles.cols.id} = ${"a1"}
		`;

		expect(article).not.toBeNull();
		expect(article!.title).toBe("Hello World");
		// Derived properties are lazy getters
		expect(article!.titleUpper).toBe("HELLO WORLD");
		expect(article!.wordCount).toBe(8);

		// Derived properties are non-enumerable (not in Object.keys)
		expect(Object.keys(article!)).not.toContain("titleUpper");
		expect(Object.keys(article!)).not.toContain("wordCount");

		await driver.close();
	});
});
