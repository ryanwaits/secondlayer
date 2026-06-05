---
"@secondlayer/shared": minor
---

Support the chain/control-plane database split: migrate every configured database (source + target), and add an assertDbSplit boot guard that warns when SOURCE_/TARGET_DATABASE_URL collapse to one DB. No behavior change in single-DB mode (DATABASE_URL only)
