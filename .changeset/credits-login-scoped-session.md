---
"@secondlayer/cli": minor
---

Archive credits calls (`credits balance`, `credits refill`, and the metered `bootstrap` and `repair` quote and fetch) send the `secondlayer login --credits` session first, then an `sk-sl_` or `ss-sl_` env key; a bare `INSTANCE_TOKEN` is never sent off the box, and a 401 names `secondlayer login --credits` and says when an instance token was ignored. `login --credits` and `logout --credits` log in to and out of the credits API; `credits` and `whoami` target it. `~/.secondlayer/session.json` is now keyed by API URL (`{ sessions: { [url]: session } }`); an old flat file reads as the login for the default credits API. `HOME` is honored when locating the session file.
