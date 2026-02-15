# @secondlayer/sdk

## 0.3.0

### Minor Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

## 0.2.0

### Minor Changes

- Add @secondlayer/sdk - TypeScript client for SecondLayer API with stream management, view queries, and queue stats
