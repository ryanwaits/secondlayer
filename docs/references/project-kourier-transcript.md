# Project Kourier — Walkthrough Transcript

**Source:** Video walkthrough by Thomas Osmonson (aulneau), Fundamental Systems, circa 2022.
**Companion article:** [paragraph.com/@aulneau/project-kourier](https://paragraph.com/@aulneau/project-kourier)
**Why this is in the repo:** Kourier is the architectural lineage for Second Layer. The layered model — raw events as a public utility, canonical-state as a shared service, per-app indexers on top — comes from this work. Quoting it directly keeps our positioning honest and keeps the credit where it belongs.

This transcript is a reference. It is not durable strategy (`VISION.md` is). When in doubt, the four root docs win; this file exists so any agent working in the repo can ground decisions in the original framing.

---

## Transcript

00:01 I haven't one. My name is Thomas and I work at a crypto product studio called fundamental systems. And then I'm going to walk through an update on the project that we've been working on, which we've named project career.

00:20 Yeah, so the high level overview of this project is really, you know, kind of the culmination of wanting to build applications that are maybe more complex or very bespoke or unique to a, given a set of contracts that exist in stacks.

00:45 And you know, at the studio, we've worked on a lot of different apps. Most recently we've kind of helped gamma rebuilt their front end and also their backend services. Gamma is one of the leading NFT marketplaces on stacks. I also created stacking.club and I've built out a few other kind of pretty data, heavy applications on stacks and kind of the common theme across all these different applications is, you know, you need data specific to your given use case from the network.

01:21 And you want to be able to do stuff with it. You know, you want to be able to query it in a way that is maybe more selective or specific than maybe a generic API might want to, or need to expose. Right.

01:35 And so for the past, about six months, I've been doing a lot of research into kind of alternative architectures around, you know, like how do things like the graph work on Ethereum and other networks and, you know, what kind of indexing services run on different blockchains and stuff like that. And I think I've come up with something that I think could be really powerful if kind of worked on and developed in a way that is really accessible.

02:09 So yeah, I'm gonna kinda just walk through a little bit of an overview of the way that the current architecture kind of works on stacks at least you know, we have kind of a main, we have got really one main API that exists in stacks and that API is made by you know, the company named hero. And it's the, you know, Stack's blockchain API is kind of the get hub repo name, but the general idea behind the way that works is you know, we have an instance of the stacks node, which is kind of the, the software that, you know, runs the blockchain and, you know, you can run it as a minor, you come on it and it's just a node that kind of watches what's going on on the network.

02:57 And when you run one of these nodes it kind of, it sinks from all of its neighbors. So it connects to all the different nodes running on the network. And I was like, Hey, I need this data. Where are we right now? How do I get there? And as it's doing this, it's emitting payloads of data for everything that it sees, right? So as it progresses in block height it'll emit Jason objects of kind of whatever it's seen and the way that the current API architecture is at least at the time of this video is so you have a, a sax node running and then right next to the Stax node, you have a bunch of different things that hero has made.

03:42 One is it really isn't, it's JavaScript like a node JS application that has a few different purposes, right. And one of them is we're going to watch for these events and we're going to do stuff with these events, right? And so the event observer kind of watches and connects directly to the stacks node. And as events come in, it's like, okay, Hey, I'm going to back up this raw event into a database, but then at the same time, I'm going to process this raw event and I'm going to kind of convert this raw data into more useful data. Right.

04:18 And as it's doing that it we'll kind of go through all the different things and it will push like things like blocks and transactions and events into the database. And it will conform to a given schema and a schema is a way of shaping the data. That makes sense in the context of the database.

04:44 In addition to the transformation of this raw data, what it's gonna do is there's this concept of canonical state and what the really high level of that is essentially is forking can happen in the context of a blockchain where maybe multiple minors trying to mine a block, and one is mining a block that is referencing a different kind of set of blocks before it. And if that minor happens to mine, the next block that would be considered a fork because like the next couple of blocks is behind, it will, will be different.

05:18 It's really kind of simplification of the thing, but the basic gist of it is, you know, sometimes if you've had a transaction confirmed the last few blocks and this happens, it might not be in the same block as it was very common and very normal. Like it happens in Bitcoin too. That's kind of why you have this concept of confirmations in Bitcoin and other chains.

05:42 But so back to the architecture the API will kind of handle these reorg or, or fork behavior. And we'll basically be like, okay, we got a new block and we'll like, look at what we have in the database currently. And if it's different and if there's been a fork, you know, we're going to go back and transform all this data. And then we we kind of upload the data, we, the new data we got, right.

06:19 And then in addition to all of this kind of organizational stuff there's also a view into the database that this architecture is doing. And it's exposing that data as like a rest API, meaning it's just an API that you can kind of call in any kind of application you want. Right? So there's one huge service that kind of does all of these different things. And I know that they've kind of spoken a little bit about breaking them out, and I really hope that that is a direction he takes.

06:40 But there's some downsides to this single architecture. If I wanted to run this node, which I have wanted to do like this API I have to run a Stax node with it. What happens if the node fails, which it can, and it has you more often than not, we'll need to resync from Genesis, which takes a few days. It's definitely been getting faster, which is great. Most people don't want to do this, like, I've, I bet I've spent so many hours doing this. I really don't want to do it anymore.

07:14 I know there's a lot of work making it easier, but it's still just a pain. You know, I want to build apps. I don't want to have to like run a node and then do all this other stuff for it. And there are ways like, you know, there are ways in which you can kind of re sync from saved persistent data, but that's, it's not necessarily easy on kind of run of the mill you know, like Heroku or any of these kind of digital ocean platforms. Right.

07:34 And then finally, the data that I get from this is ultimately defined kind of by hero and what they want to implement. Right. Like, of course I can make PR and change some of it, but it's still just very fixed, you know if I have very specific demands for my application it might not make sense to implement this in an API that everyone uses. Right.

07:58 So what, what would be an alternative? And this is kind of what, you know, I've been thinking about for the last few months in ways in which we can kind of split these services out into something that's more accessible to the larger audience of, of developers. Right?

08:15 So the first thing that I would do differently is kind of break out the first part of the architecture that we saw previously, where it's kind of just, I want to have a service that I can deploy that sits next to a Stax node. And what it's going to do is it's going to tank all the Rob and it's going to put into a database. It could be any kind of database doesn't really matter in this instance, you know, I'm a lot of the stuff we're already doing is in Postgres. So that's why I would put it. And then we would just expose that as an API that anyone can fetch data from it kind of like a public service, right?

08:52 If you want copies of, you know, the canonical, the, just the raw data from a node, we can cash. It, it's immutable. It will never change once it's been kind of confirmed. And so, yeah, we can make use of kind of the web architecture that we have and cash things, and make really performance kind of like data dumps, things like that. Maybe even expose it as like a self updating kind of like S3 bucket that people can sing from advantages of this.

09:19 You know, most people would probably never actually going to interact with it because with this new architecture, we're thinking about staff, the ways in which we can kind of stack our indexers on top of one another, right. Where previously, you know, you have one monolithic kind of service that does everything. I think we could really become a lot more sophisticated by stacking these different things for different purposes. Right.

09:44 And addition, additional benefit of this is, you know, we can run many of them and we can kind of use them behind a load balance or, or what have you. And, and there's more redundancies, right. And if we have multiple running, then other clients won't fail or won't, you know, crash because one of these would crash. Right.

10:19 And then kinda on top of that, what I was thinking of kind of as the next step would be, you know, we have this kind of just like the data store, right. Of all of the events, like, because it doesn't change immutable, it can kind of just exist on its own. Then we have all these different services that will fetch data from that and do what ever it needs to do with that data.

10:31 And so rather than forcing everyone to maybe run a service that fetches data from the Robbins, what I thought would make sense is we run another service on top of it that simply tracks, if there are any changes in the raw events, meaning there's a new event, that's come in, we process it. And we kind of handle the conical state in this section of the stack. Right.

11:01 And so we fetch data from the Robbins. Then we do the same kind of processing that the hero API is doing currently. But, but instead of kind of conforming to the schema that hero API has, it's just a very generic open-ended database structure where, you know, you have a table for blocks, micro blocks, you know, whatever has been in the mem pool. You know, historically we can have that as well, transactions, attachments, and then events, right? Each of those can kind of just exist on their own.

11:29 And it wouldn't necessarily be exposed in the same way that the hero API is exposed. This wouldn't be more for like indexers on top of this service that want to expose data in a way that's important to them.

11:45 And then the other kind of little bit different thing that this would expose is I think there could be an end point for just exposing the canonical block hashes. That way clients can use those to ensure that whatever data they have is, is canonical. And if not, then they can re-sync as, as needed.

12:05 So what are the advantages of this? Well, all the clients, although consumers would use this rather than kind of using the higher level kind of Robins, so they don't need to necessarily handle canonical state in their own instance. They would kind of just sink from this and it would already be canonical. There would need to be some redundancy within each service that kind of would handle reorganizations just on the fly, but it'd be much more simple than kind of the current architecture.

12:43 Clients, when you're building the scene, you want to build an API that uses this, you can kind of pick and choose what you want. Right. Meaning you don't need to take everything if you don't use it. So if you only care about maybe events conforming to a certain trait, right, like a related to a certain trait contract you could do that. You know, it'd be really easy to write a query that would return that data for you.

13:16 You know, sinking is so much faster if, if we do it this way, because we're not relying on kind of the need to sync from a live instance of the node, it's really just kind of, the bottleneck is whatever the connection speed is. And some, a little bit of CPU and Ram, right.

13:24 And then if you know, the node fails, you know, this service doesn't fail, right? Because there's redundancies above it where, you know, if every single note that was kind of pushing data to the, to the Gras events kind of thing failed, and obviously this would fail, but you know, it's much less likely in this scenario.

13:48 So yeah, this is kind of microservice too. This is just like a, a second layer indexer that people would use to produce different types of API APIs.

14:02 And so, you know, we have some examples of what maybe we would want. So since I said, I built second.club, this was kind of my first entrance into building out kind of bespoke API APIs or data and indexing stuff. And you could use this new architecture to build an API that just cares about stacking related transactions or events.

14:39 And so, you know, from the previous microservice, what we would end up doing is we'd be fetching only the data we care about. And in this context, it would be more or less just any kind of transaction related to some kind of PO ex you know, proof of transfer transactions, whether that's the original box contract, or it could be maybe some of the other contracts that implement stacking, you know, like delegated, stacking, things like that. You would write a little bit of JavaScript or whatever language you wanted to kind of pick out the data you wanted and then process it as you needed.

14:49 And so I imagine that there could be a set of tools or libraries in which there would be helper functions, right? So you can kind of think of it as like, you know, we're streaming in this data from kind of the upper level indexer, and we can have helper functions that are like, I want any event associated with this contract. And if I have these events, then I'm going to process them in this way. Right.

15:29 Or you can even do things like, you know, I want any events or any transactions that are associated with a contract that conforms to a given trait. And so you could imagine there's one for September, we said nine. So that means I could easily build like a metadata indexer with this kind of architecture where anything that conforms to September, I'm going to process, and I'm going to kind of you know, utilize the functions in that, you know, define standard or trade. And and then use that data as I need to.

15:49 Another example of application you can build with this architecture would be like a web hook, kind of like a discord bot kind of thing where it's it's a long running node process that is watching for things in the mem pool watching for transactions or events. And then depending on a certain condition, would fire a, you know, a web hook that then would you know, interact with a discord bot or something like that.

16:21 And so, you know, again with kind of the libraries that could exist in this architecture you could have a function that's like is NFD sale event. Meaning maybe there's a function that automatically can process a given transaction for you and return that it is indeed a sale event or something else. And if it's something else we just kind of ignore it. Right.

16:53 And then finally, you know, with this same architecture, you could power the hero API, right. And so it's more or less taking everything that hero has done and kind of paved the way for separating the mound and then kind of picking and choosing what you need. And so if they wanted to hero could contribute to this, so they could even use kind of the data processing, like higher level indexers to, to push data into their schema for their database and then expose the same API that they do normally. Right.

17:32 So yeah, this is kind of like, you know, the overview of what we've been thinking about for the past you know, six months or so six to nine months. And I'm really excited about it. I think, I think this open, it could open the door for like so many different use cases. I'm really excited about it.

17:49 And the other managers of this kind of thing too, are, you know, maybe I don't want to use Postgres. I want to use planet scale, or maybe I want to use Prisma as my RM, or I want to, you know, use my SQL or, or maybe a no SQL database. Right. With these tools, it allows engineers and developers to kind of work with whatever they want that they're most comfortable with, or maybe whatever their applications need and then expose data as they, they want or prefer. Right.

18:12 So I much prefer using graph QL over a standard rest API. And so I would use all of these tools to produce APIs that allow me to do that. Right.

18:22 Yeah. So I really hope you enjoyed kind of this walkthrough. I apologize. It was kind of a lot more deep, like deep in the weeds than I thought would be, but feel free to reach out to me on Twitter or get up or email me at high at fundable systems. I'll also include my email kind of with this post too, but yeah, really exciting. And I'll, I'll kind of keep, keep y'all updated to our progress, but yeah. Thanks for tuning in.

---

## Mapping Kourier concepts to Second Layer products

| Kourier concept | Second Layer product | Notes |
|---|---|---|
| Public raw events service ("self-updating S3 bucket people can sync from") | **Stacks Streams** (cursor API + parquet bulk dumps) | Same idea: immutable, cacheable, the foundation everything else builds on. |
| "Second layer indexer" handling canonical state once for everyone | **Stacks Index** | Decoded transactions, reorg-resolved, served as REST. The rename of the project to Second Layer is a direct nod. |
| Canonical block hash endpoint | `GET /v1/streams/canonical/{height}` | Lifted directly. External indexers self-verify without replaying our reorg history. |
| App-specific indexers (stacking.club, NFT metadata, mempool bots) | **Stacks Subgraphs** + Templates shelf | Subgraph manifests with named templates: Stacking Indexer, SIP-009 Metadata, NFT Sale Watcher, Mempool Tracker. |
| Webhook bot for "is NFT sale event" | **Subscriptions** | Managed tail with conditional delivery, sitting on decoded data. |
| Helper-function library for trait-aware filtering | **`@secondlayer/sdk`** | Opinionated about Stacks idioms: `isSIP010Transfer`, `isSIP009Mint`, contract-conformance helpers. |
| "Hiro could power their API on top of this" | **Partner Platform** (Phase 4) | Tenancy plane that lets a partner provision, meter, and bill nested customers on Second Layer infrastructure. |

## What Kourier did not specify (and where we go further)

- **Pricing tiers and metering.** Kourier was an architectural proposal; commercial structure is ours.
- **Subgraph runtime as a managed product.** Kourier described per-app indexers as a pattern; we ship them as a hosted product with checkpointed backfill, auto-pause, and tenant isolation.
- **MCP server for AI agents.** Not in scope for Kourier's era.
- **Foundation Datasets shelf as a public good.** Distinct product line; aligns with grant-funded ecosystem work.
- **Partner Platform as a contracted product.** Kourier hinted Hiro could consume the architecture; we package that consumption as a sellable, multi-tenant platform with admin APIs and SLA contracts.

## Why we preserve this transcript

Three reasons.

1. **Lineage.** Kourier predates Second Layer by years. Saying so plainly is correct, and it changes how the Stacks ecosystem reads our positioning.
2. **Disambiguation.** When future agents (or future Ryan) wonder *why* the L1/L2/L3 split, the canonical block hash endpoint, or the parquet S3 dumps exist, the answer is in this transcript. Architectural decisions stick when their reasons are visible.
3. **Hiro framing.** The line "you could power the Hiro API with this... Hiro could contribute to this" came from aulneau in 2022. When we deliver the Hiro one-pager in Phase 3, that line is the cleanest possible opening.
