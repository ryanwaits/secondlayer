import { describe, expect, test } from "bun:test";
import { inferAssociations } from "../schema/associations.ts";
import type { ColumnInfo, SchemaInfo, TableInfo } from "../schema/types.ts";

function col(name: string, opts: Partial<ColumnInfo> = {}): ColumnInfo {
	return {
		name,
		dataType: "text",
		nullable: false,
		hasDefault: false,
		isPrimaryKey: false,
		...opts,
	};
}

function table(
	name: string,
	columns: ColumnInfo[],
	opts: Partial<TableInfo> = {},
): TableInfo {
	return { name, columns, primaryKey: "id", uniqueColumns: new Set(), ...opts };
}

describe("inferAssociations", () => {
	test("belongs_to + has_many from FK", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				[
					"users",
					table("users", [col("id", { isPrimaryKey: true }), col("email")]),
				],
				[
					"posts",
					table("posts", [
						col("id", { isPrimaryKey: true }),
						col("title"),
						col("user_id"),
					]),
				],
			]),
			foreignKeys: [
				{
					fromTable: "posts",
					fromColumn: "user_id",
					toTable: "users",
					toColumn: "id",
				},
			],
		};

		const assocs = inferAssociations(schema);

		expect(assocs.posts).toHaveLength(1);
		expect(assocs.posts[0]).toMatchObject({
			type: "belongs_to",
			name: "user",
			fromTable: "posts",
			toTable: "users",
			foreignKey: "user_id",
		});

		expect(assocs.users).toHaveLength(1);
		expect(assocs.users[0]).toMatchObject({
			type: "has_many",
			name: "posts",
			fromTable: "users",
			toTable: "posts",
			foreignKey: "user_id",
		});
	});

	test("has_one when FK column is unique", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				["users", table("users", [col("id", { isPrimaryKey: true })])],
				[
					"profiles",
					table(
						"profiles",
						[col("id", { isPrimaryKey: true }), col("user_id")],
						{
							uniqueColumns: new Set(["user_id"]),
						},
					),
				],
			]),
			foreignKeys: [
				{
					fromTable: "profiles",
					fromColumn: "user_id",
					toTable: "users",
					toColumn: "id",
				},
			],
		};

		const assocs = inferAssociations(schema);
		expect(assocs.users[0]).toMatchObject({
			type: "has_one",
			name: "profile",
		});
		expect(assocs.profiles[0]).toMatchObject({
			type: "belongs_to",
			name: "user",
		});
	});

	test("has_many_through via join table", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				[
					"students",
					table("students", [col("id", { isPrimaryKey: true }), col("name")]),
				],
				[
					"courses",
					table("courses", [col("id", { isPrimaryKey: true }), col("title")]),
				],
				[
					"enrollments",
					table("enrollments", [
						col("id", { isPrimaryKey: true }),
						col("student_id"),
						col("course_id"),
					]),
				],
			]),
			foreignKeys: [
				{
					fromTable: "enrollments",
					fromColumn: "student_id",
					toTable: "students",
					toColumn: "id",
				},
				{
					fromTable: "enrollments",
					fromColumn: "course_id",
					toTable: "courses",
					toColumn: "id",
				},
			],
		};

		const assocs = inferAssociations(schema);

		// students has_many_through courses
		const studentAssocs = assocs.students;
		expect(studentAssocs).toContainEqual(
			expect.objectContaining({
				type: "has_many_through",
				name: "courses",
				toTable: "courses",
				through: "enrollments",
			}),
		);

		// courses has_many_through students
		const courseAssocs = assocs.courses;
		expect(courseAssocs).toContainEqual(
			expect.objectContaining({
				type: "has_many_through",
				name: "students",
				toTable: "students",
				through: "enrollments",
			}),
		);
	});

	test("join table with extra columns (<=2) still detected", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				["tags", table("tags", [col("id", { isPrimaryKey: true })])],
				["articles", table("articles", [col("id", { isPrimaryKey: true })])],
				[
					"article_tags",
					table("article_tags", [
						col("id", { isPrimaryKey: true }),
						col("article_id"),
						col("tag_id"),
						col("created_at"),
					]),
				],
			]),
			foreignKeys: [
				{
					fromTable: "article_tags",
					fromColumn: "article_id",
					toTable: "articles",
					toColumn: "id",
				},
				{
					fromTable: "article_tags",
					fromColumn: "tag_id",
					toTable: "tags",
					toColumn: "id",
				},
			],
		};

		const assocs = inferAssociations(schema);
		expect(assocs.articles).toContainEqual(
			expect.objectContaining({
				type: "has_many_through",
				through: "article_tags",
			}),
		);
	});

	test("table with >2 extra cols is NOT a join table", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				["users", table("users", [col("id", { isPrimaryKey: true })])],
				["teams", table("teams", [col("id", { isPrimaryKey: true })])],
				[
					"memberships",
					table("memberships", [
						col("id", { isPrimaryKey: true }),
						col("user_id"),
						col("team_id"),
						col("role"),
						col("joined_at"),
						col("nickname"),
					]),
				],
			]),
			foreignKeys: [
				{
					fromTable: "memberships",
					fromColumn: "user_id",
					toTable: "users",
					toColumn: "id",
				},
				{
					fromTable: "memberships",
					fromColumn: "team_id",
					toTable: "teams",
					toColumn: "id",
				},
			],
		};

		const assocs = inferAssociations(schema);
		// Should be regular belongs_to/has_many, not through
		expect(assocs.memberships).toContainEqual(
			expect.objectContaining({ type: "belongs_to", name: "user" }),
		);
		expect(assocs.memberships).toContainEqual(
			expect.objectContaining({ type: "belongs_to", name: "team" }),
		);
		expect(assocs.users).toContainEqual(
			expect.objectContaining({ type: "has_many", name: "memberships" }),
		);
		// No has_many_through
		expect(assocs.users).not.toContainEqual(
			expect.objectContaining({ type: "has_many_through" }),
		);
	});

	test("no FKs → empty associations", () => {
		const schema: SchemaInfo = {
			tables: new Map([
				[
					"logs",
					table("logs", [col("id", { isPrimaryKey: true }), col("msg")]),
				],
			]),
			foreignKeys: [],
		};
		expect(inferAssociations(schema)).toEqual({});
	});
});
