---
"@secondlayer/cli": major
---

`login` and `logout` always sign you in and out of your Secondlayer account; `--credits` is gone, since one account and one credit balance cover rows, your hosted stack and archive fetches. Browser `login` now signs the machine in with a session, like `login --email`, instead of saving an API key, so the Keys tab only lists keys you made. Credit and archive messages say "credits" and point at `secondlayer login`.
