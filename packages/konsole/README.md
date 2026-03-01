# konsole

Rails-style interactive console for any Postgres database. Auto-discovers schema, infers associations from foreign keys, generates ActiveRecord-style models.

## Quick Start

```bash
# via env var
DATABASE_URL=postgres://user:pass@localhost:5432/mydb bun run konsole

# via CLI arg
bun run konsole postgres://user:pass@localhost:5432/mydb
```

Connects, introspects `information_schema`, prints discovered models and associations, drops you into a REPL.

## Querying

Models are auto-generated from table names (`users` → `User`, `api_keys` → `ApiKey`).

```ruby
# All records (lazy, chainable)
User.all
User.all.size

# Find by primary key
User.find("some-uuid")
User.find(42)

# First / last (getter or with count)
User.first
User.last
User.first(5)          # first 5 records
User.last(3)           # last 3 records
User.last(3).first     # first of the last 3

# Where (chainable)
User.where({ plan: "pro" })
User.where({ plan: "pro", active: true })
User.where("email", "ryan@example.com")
User.not({ plan: "free" })

# Ruby-style hash syntax works too
User.where(plan: "pro")
User.not(plan: "free")

# Chain everything
User.where(plan: "pro").order("created_at", "desc").limit(10)
User.where(plan: "pro").offset(20).limit(10)
User.where(plan: "pro").not(active: false).first

# Count / exists
User.count
User.where(plan: "pro").count
User.where(plan: "pro").size     # alias
User.where(plan: "pro").length   # alias
User.exists({ email: "x@y.com" })

# Pluck single column
User.pluck("email")
User.where(plan: "pro").pluck("id")

# Attribute projection
User.first.email
User.where(plan: "pro").email    # array of emails
```

## Dynamic Finders

```ruby
User.findByEmail("ryan@example.com")
User.findByPlan("pro")
User.findByEmailAndPlan("ryan@example.com", "pro")
```

Attribute names are camelCase → snake_case (`findByCreatedAt` → `created_at`). Multi-attribute via `And`. Returns single record or null.

## Associations

Inferred automatically from foreign keys.

```ruby
# belongs_to (table has the FK)
post.author           # Post has author_id → returns User record

# has_many (inverse of belongs_to)
user.posts            # posts.user_id → returns QueryChain

# has_one (FK column has UNIQUE constraint)
user.profile          # profiles.user_id (unique) → returns single record

# has_many_through (join table with exactly 2 FKs)
student.courses       # through enrollments table
```

## Joins

```ruby
# Inner join via association name
User.joins("posts")
User.joins("api_keys", "sessions")

# Left outer join
User.leftJoins("sessions")

# Where on joined table
User.joins("api_keys").where("api_keys.status", "active")
User.joins("posts").where({ "posts.published": true })

# Distinct (avoid duplicates from has_many joins)
User.joins("posts").distinct
User.joins("posts").distinct.count

# Left join + null check = "users without sessions"
User.leftJoins("sessions").where("sessions.id", null).count
```

## Mutations

```ruby
# Create
let u = User.create({ email: "new@example.com", plan: "free" })

# Update (instance)
u.update({ plan: "pro" })

# Update (bulk)
User.where(plan: "free").update({ plan: "starter" })

# Destroy
u.destroy()
User.where(active: false).destroy()

# Reload from DB
u.reload()
```

## Variables

```ruby
let u = User.first
u.email                    # access attributes
u.posts                    # follow associations
let count = User.count     # store any result
```

## Raw SQL

```ruby
rawSql("SELECT now()")
rawSql("SELECT count(*) FROM users WHERE plan = 'pro'")

# Kysely sql tag also available
db                         # raw Kysely instance
sql                        # Kysely sql template tag
```

## Commands

| Command | Description |
|---------|-------------|
| `.tables` | List all tables |
| `.counts` | Row count per table |
| `.desc <table>` | Describe table columns |
| `.schema` | Full schema: tables, columns, associations |
| `.relations <table>` | Associations for a specific table |
| `.help` | Show help |
| `.exit` / `exit` / Ctrl+C | Quit |

## SQL Preview

```ruby
User.where(plan: "pro").joins("posts").toSql()
# → select "users".* from "users" inner join "posts" on "posts"."user_id" = "users"."id" where "plan" = $1
```

## Tab Completion

Tab completes model names, dot commands, context variables, and column names inside `where(`.
